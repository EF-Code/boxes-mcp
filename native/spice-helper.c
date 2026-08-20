#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include <gio/gio.h>
#include <gio/gunixinputstream.h>
#include <json-glib/json-glib.h>
#include <libvirt/libvirt.h>
#include <spice-client.h>
#include <spice/vd_agent.h>

#define PROTOCOL_VERSION 1
#define MAX_LINE_BYTES (4u * 1024u * 1024u)
#define DEFAULT_MAX_CLIPBOARD_BYTES (1024u * 1024u)
#define DEFAULT_MAX_TRANSFER_BYTES (100u * 1024u * 1024u)
#define DEFAULT_TIMEOUT_MS 30000u

typedef struct _HelperState HelperState;
typedef struct _Request Request;

struct _Request {
    HelperState *state;
    gchar *id;
    gchar *operation;
    gboolean done;
    gboolean success;
    gchar *error_code;
    gchar *error_message;
    gchar *clipboard_text;
    gsize clipboard_bytes;
    guint64 clipboard_max_bytes;
    guint64 transferred_bytes;
    guint64 total_bytes;
    gboolean drag_transfer_completed;
    gboolean drag_mouse_released;
    GCancellable *cancellable;
    GFile *source;
};

struct _HelperState {
    GMainLoop *loop;
    GDataInputStream *input;
    SpiceSession *session;
    SpiceMainChannel *main_channel;
    SpiceInputsChannel *inputs_channel;
    SpiceDisplayChannel *display_channel;
    gchar *domain;
    gchar *uri;
    gchar *transport;
    gchar *libvirt_uri;
    virConnectPtr libvirt_connection;
    virDomainPtr libvirt_domain;
    gboolean main_open;
    gboolean inputs_open;
    gboolean display_open;
    gboolean agent_connected;
    gint display_width;
    gint display_height;
    guint button_state;
    Request *active;
};

static gboolean clipboard_grab_cb(SpiceMainChannel *channel, guint selection, guint32 *types,
                                  guint ntypes, gpointer user_data);
static void clipboard_selection_cb(SpiceMainChannel *channel, guint selection, guint type,
                                   gpointer data, guint size, gpointer user_data);
static void clipboard_release_cb(SpiceMainChannel *channel, guint selection, gpointer user_data);
static gboolean clipboard_request_cb(SpiceMainChannel *channel, guint selection, guint type,
                                     gpointer user_data);
static void channel_open_fd_cb(SpiceChannel *channel, gint with_tls, gpointer user_data);

static void emit_node(JsonNode *node) {
    JsonGenerator *generator = json_generator_new();
    gchar *text;
    json_generator_set_root(generator, node);
    text = json_generator_to_data(generator, NULL);
    if (text != NULL) {
        fputs(text, stdout);
        fputc('\n', stdout);
        fflush(stdout);
    }
    g_free(text);
    g_object_unref(generator);
}

static void emit_error(const gchar *id, const gchar *code, const gchar *message) {
    JsonBuilder *builder = json_builder_new();
    JsonNode *node;
    json_builder_begin_object(builder);
    json_builder_set_member_name(builder, "version");
    json_builder_add_int_value(builder, PROTOCOL_VERSION);
    json_builder_set_member_name(builder, "id");
    json_builder_add_string_value(builder, id != NULL ? id : "");
    json_builder_set_member_name(builder, "ok");
    json_builder_add_boolean_value(builder, FALSE);
    json_builder_set_member_name(builder, "error");
    json_builder_begin_object(builder);
    json_builder_set_member_name(builder, "code");
    json_builder_add_string_value(builder, code != NULL ? code : "SPICE_UNAVAILABLE");
    json_builder_set_member_name(builder, "message");
    json_builder_add_string_value(builder, message != NULL ? message : "SPICE helper operation failed");
    json_builder_end_object(builder);
    json_builder_end_object(builder);
    node = json_builder_get_root(builder);
    emit_node(node);
    json_node_free(node);
    g_object_unref(builder);
}

static void emit_result(const gchar *id, JsonNode *result) {
    JsonBuilder *builder = json_builder_new();
    JsonNode *node;
    json_builder_begin_object(builder);
    json_builder_set_member_name(builder, "version");
    json_builder_add_int_value(builder, PROTOCOL_VERSION);
    json_builder_set_member_name(builder, "id");
    json_builder_add_string_value(builder, id != NULL ? id : "");
    json_builder_set_member_name(builder, "ok");
    json_builder_add_boolean_value(builder, TRUE);
    json_builder_set_member_name(builder, "result");
    json_builder_add_value(builder, json_node_copy(result));
    json_builder_end_object(builder);
    node = json_builder_get_root(builder);
    emit_node(node);
    json_node_free(node);
    g_object_unref(builder);
}

static void emit_progress(const gchar *id, guint64 transferred, guint64 total) {
    JsonBuilder *builder = json_builder_new();
    JsonNode *node;
    json_builder_begin_object(builder);
    json_builder_set_member_name(builder, "version");
    json_builder_add_int_value(builder, PROTOCOL_VERSION);
    json_builder_set_member_name(builder, "id");
    json_builder_add_string_value(builder, id != NULL ? id : "");
    json_builder_set_member_name(builder, "event");
    json_builder_add_string_value(builder, "progress");
    json_builder_set_member_name(builder, "progress");
    json_builder_begin_object(builder);
    json_builder_set_member_name(builder, "bytes");
    json_builder_add_int_value(builder, (gint64) transferred);
    json_builder_set_member_name(builder, "totalBytes");
    json_builder_add_int_value(builder, (gint64) total);
    json_builder_end_object(builder);
    json_builder_end_object(builder);
    node = json_builder_get_root(builder);
    emit_node(node);
    json_node_free(node);
    g_object_unref(builder);
}

static void request_fail(Request *request, const gchar *code, const gchar *message) {
    if (request == NULL || request->done) return;
    request->success = FALSE;
    request->done = TRUE;
    g_free(request->error_code);
    g_free(request->error_message);
    request->error_code = g_strdup(code);
    request->error_message = g_strdup(message);
}

static void request_succeed(Request *request) {
    if (request == NULL || request->done) return;
    request->success = TRUE;
    request->done = TRUE;
}

static void request_free(Request *request) {
    if (request == NULL) return;
    g_free(request->id);
    g_free(request->operation);
    g_free(request->error_code);
    g_free(request->error_message);
    g_free(request->clipboard_text);
    g_clear_object(&request->cancellable);
    g_clear_object(&request->source);
    g_free(request);
}

static void clear_session(HelperState *state) {
    if (state->session != NULL) spice_session_disconnect(state->session);
    g_clear_object(&state->main_channel);
    g_clear_object(&state->inputs_channel);
    g_clear_object(&state->display_channel);
    g_clear_object(&state->session);
    if (state->libvirt_domain != NULL) {
        virDomainFree(state->libvirt_domain);
        state->libvirt_domain = NULL;
    }
    if (state->libvirt_connection != NULL) {
        virConnectClose(state->libvirt_connection);
        state->libvirt_connection = NULL;
    }
    g_clear_pointer(&state->domain, g_free);
    g_clear_pointer(&state->uri, g_free);
    g_clear_pointer(&state->transport, g_free);
    g_clear_pointer(&state->libvirt_uri, g_free);
    state->main_open = FALSE;
    state->inputs_open = FALSE;
    state->display_open = FALSE;
    state->agent_connected = FALSE;
    state->display_width = 0;
    state->display_height = 0;
    state->button_state = 0;
}

static void channel_event_cb(SpiceChannel *channel, SpiceChannelEvent event, gpointer user_data) {
    HelperState *state = user_data;
    gboolean open = event == SPICE_CHANNEL_OPENED;
    gint type = -1;
    g_object_get(channel, "channel-type", &type, NULL);
    if (type == SPICE_CHANNEL_MAIN) state->main_open = open;
    if (type == SPICE_CHANNEL_INPUTS) state->inputs_open = open;
    if (type == SPICE_CHANNEL_DISPLAY) state->display_open = open;
    if (event == SPICE_CHANNEL_CLOSED || event >= SPICE_CHANNEL_ERROR_CONNECT) {
        if (state->active != NULL) request_fail(state->active, "SPICE_UNAVAILABLE", "SPICE channel disconnected");
    }
}

static void agent_update_cb(SpiceMainChannel *channel, gpointer user_data) {
    HelperState *state = user_data;
    state->agent_connected = spice_main_channel_agent_test_capability(channel, VD_AGENT_CAP_CLIPBOARD)
        || !spice_main_channel_agent_test_capability(channel, VD_AGENT_CAP_FILE_XFER_DISABLED);
}

static void display_primary_create_cb(SpiceChannel *channel, gint format, gint width,
                                      gint height, gint stride, gint shmid, gpointer data,
                                      gpointer user_data) {
    HelperState *state = user_data;
    (void) channel;
    (void) format;
    (void) stride;
    (void) shmid;
    (void) data;
    state->display_width = width;
    state->display_height = height;
}

static void channel_open_fd_cb(SpiceChannel *channel, gint with_tls, gpointer user_data) {
    HelperState *state = user_data;
    int fd;
    (void) with_tls;
    if (state->libvirt_domain == NULL) {
        if (state->active != NULL) request_fail(state->active, "SPICE_UNAVAILABLE", "SPICE graphics FD session is unavailable");
        return;
    }
    fd = virDomainOpenGraphicsFD(state->libvirt_domain, 0, 0);
    if (fd < 0) {
        if (state->active != NULL) request_fail(state->active, "SPICE_UNAVAILABLE", "Unable to open a libvirt graphics FD");
        return;
    }
    if (!spice_channel_open_fd(channel, fd)) {
        close(fd);
        if (state->active != NULL) request_fail(state->active, "SPICE_UNAVAILABLE", "Unable to attach the SPICE channel graphics FD");
    }
}

static void channel_new_cb(SpiceSession *session, SpiceChannel *channel, gpointer user_data) {
    HelperState *state = user_data;
    gint type = -1;
    (void) session;
    g_object_get(channel, "channel-type", &type, NULL);
    g_signal_connect(channel, "channel-event", G_CALLBACK(channel_event_cb), state);
    if (state->libvirt_domain != NULL) {
        g_signal_connect(channel, "open-fd", G_CALLBACK(channel_open_fd_cb), state);
        if (type != SPICE_CHANNEL_MAIN) {
            spice_channel_open_fd(channel, -1);
        }
    }
    if (type == SPICE_CHANNEL_MAIN && state->main_channel == NULL) {
        state->main_channel = SPICE_MAIN_CHANNEL(g_object_ref(channel));
        g_signal_connect(state->main_channel, "main-agent-update", G_CALLBACK(agent_update_cb), state);
        g_signal_connect(state->main_channel, "main-clipboard-selection-grab", G_CALLBACK(clipboard_grab_cb), state);
        g_signal_connect(state->main_channel, "main-clipboard-selection", G_CALLBACK(clipboard_selection_cb), state);
        g_signal_connect(state->main_channel, "main-clipboard-selection-release", G_CALLBACK(clipboard_release_cb), state);
        g_signal_connect(state->main_channel, "main-clipboard-selection-request", G_CALLBACK(clipboard_request_cb), state);
    } else if (type == SPICE_CHANNEL_INPUTS && state->inputs_channel == NULL) {
        state->inputs_channel = SPICE_INPUTS_CHANNEL(g_object_ref(channel));
    } else if (type == SPICE_CHANNEL_DISPLAY && state->display_channel == NULL) {
        state->display_channel = SPICE_DISPLAY_CHANNEL(g_object_ref(channel));
        g_signal_connect(state->display_channel, "display-primary-create", G_CALLBACK(display_primary_create_cb), state);
    }
}

static gboolean ensure_session(HelperState *state, const gchar *domain, const gchar *uri, const gchar *transport) {
    if (state->session != NULL && g_strcmp0(state->domain, domain) == 0 && g_strcmp0(state->uri, uri) == 0
        && g_strcmp0(state->transport, transport) == 0) {
        return TRUE;
    }
    clear_session(state);
    state->domain = g_strdup(domain);
    state->uri = g_strdup(uri);
    state->transport = g_strdup(transport);
    state->session = spice_session_new();
    if (g_strcmp0(transport, "libvirt-fd") == 0) {
        const gchar *configured_uri = g_getenv("LIBVIRT_URI");
        state->libvirt_uri = g_strdup(configured_uri != NULL && configured_uri[0] != '\0' ? configured_uri : "qemu:///system");
        state->libvirt_connection = virConnectOpen(state->libvirt_uri);
        if (state->libvirt_connection == NULL) {
            clear_session(state);
            return FALSE;
        }
        state->libvirt_domain = virDomainLookupByName(state->libvirt_connection, domain);
        if (state->libvirt_domain == NULL) {
            clear_session(state);
            return FALSE;
        }
        g_object_set(state->session, "client-sockets", TRUE, NULL);
        g_signal_connect(state->session, "channel-new", G_CALLBACK(channel_new_cb), state);
        if (!spice_session_open_fd(state->session, -1)) {
            clear_session(state);
            return FALSE;
        }
        return TRUE;
    }
    g_object_set(state->session, "uri", uri, NULL);
    g_signal_connect(state->session, "channel-new", G_CALLBACK(channel_new_cb), state);
    if (!spice_session_connect(state->session)) {
        clear_session(state);
        return FALSE;
    }
    return TRUE;
}

static void pump_for(HelperState *state, guint timeout_ms) {
    gint64 end = g_get_monotonic_time() + ((gint64) timeout_ms * 1000);
    while (g_get_monotonic_time() < end) {
        while (g_main_context_pending(NULL)) g_main_context_iteration(NULL, FALSE);
        if (state->active != NULL && state->active->done) break;
        g_usleep(10000);
    }
}

static JsonObject *arguments_object(JsonObject *root) {
    JsonNode *node = json_object_get_member(root, "arguments");
    return node != NULL && JSON_NODE_HOLDS_OBJECT(node) ? json_node_get_object(node) : NULL;
}

static const gchar *string_member(JsonObject *object, const gchar *name) {
    JsonNode *node = object != NULL ? json_object_get_member(object, name) : NULL;
    return node != NULL && JSON_NODE_HOLDS_VALUE(node) && json_node_get_value_type(node) == G_TYPE_STRING
        ? json_node_get_string(node) : NULL;
}

static gboolean number_member(JsonObject *object, const gchar *name, gdouble *value) {
    JsonNode *node = object != NULL ? json_object_get_member(object, name) : NULL;
    if (node == NULL || !JSON_NODE_HOLDS_VALUE(node)) return FALSE;
    *value = json_node_get_double(node);
    return isfinite(*value);
}

static guint64 bounded_member(JsonObject *object, const gchar *name, guint64 fallback, guint64 maximum) {
    JsonNode *node = object != NULL ? json_object_get_member(object, name) : NULL;
    gint64 value;
    if (node == NULL || !JSON_NODE_HOLDS_VALUE(node)) return fallback;
    value = json_node_get_int(node);
    return value < 0 || (guint64) value > maximum ? fallback : (guint64) value;
}

static gboolean wait_for_channels(HelperState *state, gboolean need_inputs, guint timeout_ms) {
    if (state->main_open && (!need_inputs || state->inputs_open)) return TRUE;
    pump_for(state, timeout_ms);
    return state->main_open && (!need_inputs || state->inputs_open);
}

static JsonNode *status_result(HelperState *state) {
    JsonBuilder *builder = json_builder_new();
    JsonNode *result;
    gboolean clipboard = state->main_channel != NULL && state->main_open
        && spice_main_channel_agent_test_capability(state->main_channel, VD_AGENT_CAP_CLIPBOARD);
    gboolean file_transfer = state->main_channel != NULL && state->main_open
        && !spice_main_channel_agent_test_capability(state->main_channel, VD_AGENT_CAP_FILE_XFER_DISABLED);
    gint mouse_mode = 0;
    if (state->main_channel != NULL) g_object_get(state->main_channel, "mouse-mode", &mouse_mode, NULL);
    json_builder_begin_object(builder);
    json_builder_set_member_name(builder, "mainChannel"); json_builder_add_string_value(builder, state->main_open ? "connected" : "disconnected");
    json_builder_set_member_name(builder, "inputsChannel"); json_builder_add_string_value(builder, state->inputs_open ? "connected" : "disconnected");
    json_builder_set_member_name(builder, "displayChannel"); json_builder_add_string_value(builder, state->display_open ? "connected" : "disconnected");
    json_builder_set_member_name(builder, "agentConnected"); json_builder_add_boolean_value(builder, state->agent_connected || clipboard);
    json_builder_set_member_name(builder, "clipboard"); json_builder_add_boolean_value(builder, clipboard);
    json_builder_set_member_name(builder, "fileTransfer"); json_builder_add_boolean_value(builder, file_transfer);
    json_builder_set_member_name(builder, "mouseMode"); json_builder_add_int_value(builder, mouse_mode);
    json_builder_set_member_name(builder, "geometryKnown"); json_builder_add_boolean_value(builder, state->display_width > 0 && state->display_height > 0);
    json_builder_set_member_name(builder, "width"); json_builder_add_int_value(builder, state->display_width);
    json_builder_set_member_name(builder, "height"); json_builder_add_int_value(builder, state->display_height);
    json_builder_end_object(builder);
    result = json_builder_get_root(builder);
    g_object_unref(builder);
    return result;
}

static guint button_mask(const gchar *button) {
    if (g_strcmp0(button, "left") == 0) return SPICE_MOUSE_BUTTON_MASK_LEFT;
    if (g_strcmp0(button, "middle") == 0) return SPICE_MOUSE_BUTTON_MASK_MIDDLE;
    if (g_strcmp0(button, "right") == 0) return SPICE_MOUSE_BUTTON_MASK_RIGHT;
    return 0;
}

static gint spice_button(const gchar *button) {
    if (g_strcmp0(button, "left") == 0) return SPICE_MOUSE_BUTTON_LEFT;
    if (g_strcmp0(button, "middle") == 0) return SPICE_MOUSE_BUTTON_MIDDLE;
    if (g_strcmp0(button, "right") == 0) return SPICE_MOUSE_BUTTON_RIGHT;
    return SPICE_MOUSE_BUTTON_INVALID;
}

static gboolean do_mouse(HelperState *state, Request *request, JsonObject *args) {
    const gchar *action = string_member(args, "action");
    const gchar *button = string_member(args, "button");
    gdouble x, y, width, height, delta_x, delta_y;
    gint px, py;
    guint mask;
    gint spice_button_value;
    if (!wait_for_channels(state, TRUE, DEFAULT_TIMEOUT_MS)) {
        request_fail(request, "SPICE_CAPABILITY_MISSING", "SPICE main and inputs channels are not connected");
        return FALSE;
    }
    if (!number_member(args, "x", &x) || !number_member(args, "y", &y)) {
        request_fail(request, "INVALID_ARGUMENT", "Mouse coordinates must be finite numbers");
        return FALSE;
    }
    if (state->display_width <= 0 || state->display_height <= 0) {
        request_fail(request, "SPICE_CAPABILITY_MISSING", "SPICE display geometry is not available");
        return FALSE;
    }
    if (g_strcmp0(string_member(args, "coordinateSpace"), "normalized") == 0) {
        px = (gint) llround(x * state->display_width);
        py = (gint) llround(y * state->display_height);
    } else if (number_member(args, "width", &width) && number_member(args, "height", &height)
               && width > 0 && height > 0 && x >= 0 && y >= 0 && x <= width && y <= height) {
        px = (gint) llround(x / width * state->display_width);
        py = (gint) llround(y / height * state->display_height);
    } else {
        request_fail(request, "INVALID_ARGUMENT", "Pixel mouse coordinates require valid dimensions");
        return FALSE;
    }
    if (px < 0 || py < 0 || px > state->display_width || py > state->display_height) {
        request_fail(request, "INVALID_ARGUMENT", "Mouse coordinates are outside the display");
        return FALSE;
    }
    spice_main_channel_request_mouse_mode(state->main_channel, SPICE_MOUSE_MODE_CLIENT);
    spice_inputs_channel_position(state->inputs_channel, px, py, 0, state->button_state);
    if (g_strcmp0(action, "move") == 0) {
        request_succeed(request);
        return TRUE;
    }
    if (g_strcmp0(action, "scroll") == 0) {
        number_member(args, "deltaX", &delta_x);
        number_member(args, "deltaY", &delta_y);
        if (delta_x == 0 && delta_y == 0) {
            request_fail(request, "INVALID_ARGUMENT", "Scroll requires a non-zero delta");
            return FALSE;
        }
        if (delta_y != 0) {
            gint wheel = delta_y > 0 ? SPICE_MOUSE_BUTTON_DOWN : SPICE_MOUSE_BUTTON_UP;
            guint wheel_mask = delta_y > 0 ? SPICE_MOUSE_BUTTON_MASK_DOWN : SPICE_MOUSE_BUTTON_MASK_UP;
            spice_inputs_channel_button_press(state->inputs_channel, wheel, state->button_state | wheel_mask);
            spice_inputs_channel_button_release(state->inputs_channel, wheel, state->button_state);
        }
        if (delta_x != 0) {
            gint wheel = delta_x > 0 ? SPICE_MOUSE_BUTTON_RIGHT : SPICE_MOUSE_BUTTON_LEFT;
            spice_inputs_channel_button_press(state->inputs_channel, wheel, state->button_state);
            spice_inputs_channel_button_release(state->inputs_channel, wheel, state->button_state);
        }
        request_succeed(request);
        return TRUE;
    }
    spice_button_value = spice_button(button);
    mask = button_mask(button);
    if (spice_button_value == SPICE_MOUSE_BUTTON_INVALID || mask == 0) {
        request_fail(request, "INVALID_ARGUMENT", "Mouse button is not allowlisted");
        return FALSE;
    }
    if (g_strcmp0(action, "click") != 0) {
        request_fail(request, "INVALID_ARGUMENT", "Only move, click, and scroll are supported");
        return FALSE;
    }
    spice_inputs_channel_button_press(state->inputs_channel, spice_button_value, state->button_state | mask);
    state->button_state |= mask;
    spice_inputs_channel_button_release(state->inputs_channel, spice_button_value, state->button_state & ~mask);
    state->button_state &= ~mask;
    request_succeed(request);
    return TRUE;
}

static gboolean clipboard_grab_cb(SpiceMainChannel *channel, guint selection, guint32 *types,
                                  guint ntypes, gpointer user_data) {
    HelperState *state = user_data;
    Request *request = state->active;
    guint index;
    if (request == NULL || request->operation == NULL || g_strcmp0(request->operation, "clipboard.read") != 0
        || selection != VD_AGENT_CLIPBOARD_SELECTION_CLIPBOARD) return FALSE;
    for (index = 0; index < ntypes; index++) {
        if (types[index] == VD_AGENT_CLIPBOARD_UTF8_TEXT) {
            spice_main_channel_clipboard_selection_request(channel, selection, VD_AGENT_CLIPBOARD_UTF8_TEXT);
            return TRUE;
        }
    }
    request_fail(request, "SPICE_CAPABILITY_MISSING", "Guest clipboard does not announce UTF-8 text");
    return FALSE;
}

static void clipboard_selection_cb(SpiceMainChannel *channel, guint selection, guint type,
                                   gpointer data, guint size, gpointer user_data) {
    HelperState *state = user_data;
    Request *request = state->active;
    (void) channel;
    if (request == NULL || g_strcmp0(request->operation, "clipboard.read") != 0
        || selection != VD_AGENT_CLIPBOARD_SELECTION_CLIPBOARD || type != VD_AGENT_CLIPBOARD_UTF8_TEXT) return;
    if (size > request->clipboard_max_bytes || !g_utf8_validate(data, size, NULL)) {
        request_fail(request, "CLIPBOARD_TOO_LARGE", "Guest clipboard is invalid or exceeds the configured limit");
        return;
    }
    request->clipboard_text = g_strndup(data, size);
    request->clipboard_bytes = size;
    request_succeed(request);
}

static void clipboard_release_cb(SpiceMainChannel *channel, guint selection, gpointer user_data) {
    HelperState *state = user_data;
    (void) channel;
    if (state->active != NULL && g_strcmp0(state->active->operation, "clipboard.read") == 0
        && selection == VD_AGENT_CLIPBOARD_SELECTION_CLIPBOARD && !state->active->done) {
        request_fail(state->active, "SPICE_AGENT_DISCONNECTED", "Guest released the clipboard before data arrived");
    }
}

static gboolean clipboard_request_cb(SpiceMainChannel *channel, guint selection, guint type,
                                     gpointer user_data) {
    HelperState *state = user_data;
    Request *request = state->active;
    if (request == NULL || g_strcmp0(request->operation, "clipboard.write") != 0
        || selection != VD_AGENT_CLIPBOARD_SELECTION_CLIPBOARD || type != VD_AGENT_CLIPBOARD_UTF8_TEXT) return FALSE;
    spice_main_channel_clipboard_selection_notify(channel, selection, type,
                                                  (const guchar *) request->clipboard_text,
                                                  request->clipboard_bytes);
    request_succeed(request);
    return TRUE;
}

static gboolean do_clipboard(HelperState *state, Request *request, JsonObject *args) {
    const gchar *text = string_member(args, "text");
    guint64 max_bytes = bounded_member(args, "maxBytes", DEFAULT_MAX_CLIPBOARD_BYTES, 100u * 1024u * 1024u);
    guint64 timeout_ms = bounded_member(args, "timeoutMs", DEFAULT_TIMEOUT_MS, 120000u);
    guint32 type = VD_AGENT_CLIPBOARD_UTF8_TEXT;
    if (!wait_for_channels(state, FALSE, DEFAULT_TIMEOUT_MS) || state->main_channel == NULL
        || !spice_main_channel_agent_test_capability(state->main_channel, VD_AGENT_CAP_CLIPBOARD)) {
        request_fail(request, "SPICE_AGENT_DISCONNECTED", "SPICE guest agent clipboard capability is unavailable");
        return FALSE;
    }
    request->clipboard_max_bytes = max_bytes;
    if (g_strcmp0(request->operation, "clipboard.write") == 0) {
        if (text == NULL || !g_utf8_validate(text, -1, NULL) || strlen(text) > max_bytes) {
            request_fail(request, "CLIPBOARD_TOO_LARGE", "Clipboard text is invalid or exceeds the configured limit");
            return FALSE;
        }
        request->clipboard_text = g_strdup(text);
        request->clipboard_bytes = strlen(text);
        spice_main_channel_clipboard_selection_grab(state->main_channel,
                                                    VD_AGENT_CLIPBOARD_SELECTION_CLIPBOARD, &type, 1);
    } else {
        /* The grab and request callbacks complete the actual guest-to-host flow. */
    }
    pump_for(state, (guint) timeout_ms);
    if (!request->done) request_fail(request, "SPICE_AGENT_DISCONNECTED", "Guest clipboard did not complete");
    if (g_strcmp0(request->operation, "clipboard.write") == 0) {
        spice_main_channel_clipboard_selection_release(state->main_channel, VD_AGENT_CLIPBOARD_SELECTION_CLIPBOARD);
    }
    return request->success;
}

static void file_progress_cb(goffset current, goffset total, gpointer user_data) {
    Request *request = user_data;
    request->transferred_bytes = (guint64) current;
    request->total_bytes = (guint64) total;
    emit_progress(request->id, request->transferred_bytes, request->total_bytes);
}

static void file_copy_done_cb(GObject *source_object, GAsyncResult *result, gpointer user_data) {
    Request *request = user_data;
    GError *error = NULL;
    if (spice_main_channel_file_copy_finish(SPICE_MAIN_CHANNEL(source_object), result, &error)) {
        if (request->transferred_bytes < request->total_bytes) {
            request->transferred_bytes = request->total_bytes;
        }
        request_succeed(request);
    } else {
        request_fail(request, "SPICE_UNAVAILABLE", error != NULL ? error->message : "SPICE file transfer failed");
    }
    g_clear_error(&error);
}

static gboolean do_file_transfer(HelperState *state, Request *request, JsonObject *args) {
    const gchar *source_path = string_member(args, "sourcePath");
    guint64 max_bytes = bounded_member(args, "maxBytes", DEFAULT_MAX_TRANSFER_BYTES, 10ull * 1024ull * 1024ull * 1024ull);
    guint64 timeout_ms = bounded_member(args, "timeoutMs", DEFAULT_TIMEOUT_MS, 120000u);
    GFile *sources[2] = { NULL, NULL };
    GFileInfo *info;
    GError *error = NULL;
    if (!wait_for_channels(state, FALSE, DEFAULT_TIMEOUT_MS) || state->main_channel == NULL
        || spice_main_channel_agent_test_capability(state->main_channel, VD_AGENT_CAP_FILE_XFER_DISABLED)) {
        request_fail(request, "SPICE_CAPABILITY_MISSING", "SPICE guest agent file transfer capability is unavailable");
        return FALSE;
    }
    if (source_path == NULL || source_path[0] == '\0' || strpbrk(source_path, "\r\n") != NULL) {
        request_fail(request, "TRANSFER_PATH_DENIED", "A regular source path is required");
        return FALSE;
    }
    request->source = g_file_new_for_path(source_path);
    info = g_file_query_info(request->source, G_FILE_ATTRIBUTE_STANDARD_TYPE "," G_FILE_ATTRIBUTE_STANDARD_SIZE,
                             G_FILE_QUERY_INFO_NOFOLLOW_SYMLINKS, NULL, &error);
    if (info == NULL || g_file_info_get_file_type(info) != G_FILE_TYPE_REGULAR) {
        request_fail(request, "TRANSFER_PATH_DENIED", "Only regular readable files can be transferred");
        g_clear_error(&error);
        g_clear_object(&info);
        return FALSE;
    }
    if ((guint64) g_file_info_get_size(info) > max_bytes) {
        request_fail(request, "TRANSFER_TOO_LARGE", "The transfer exceeds the configured size limit");
        g_clear_object(&info);
        return FALSE;
    }
    request->total_bytes = (guint64) g_file_info_get_size(info);
    g_clear_object(&info);
    request->cancellable = g_cancellable_new();
    sources[0] = request->source;
    spice_main_channel_file_copy_async(state->main_channel, sources, G_FILE_COPY_NONE, request->cancellable,
                                       file_progress_cb, request, file_copy_done_cb, request);
    pump_for(state, (guint) timeout_ms);
    if (!request->done) {
        g_cancellable_cancel(request->cancellable);
        request_fail(request, "OPERATION_TIMEOUT", "SPICE file transfer timed out");
    }
    return request->success;
}

static gboolean do_drag_drop(HelperState *state, Request *request, JsonObject *args) {
    gdouble x, y, width, height;
    gint px, py;
    guint left_mask = SPICE_MOUSE_BUTTON_MASK_LEFT;
    gboolean pressed = FALSE;
    if (!do_file_transfer(state, request, args)) return FALSE;
    request->done = FALSE;
    request->success = FALSE;
    request->drag_transfer_completed = TRUE;
    if (!wait_for_channels(state, TRUE, DEFAULT_TIMEOUT_MS)
        || state->display_width <= 0 || state->display_height <= 0) {
        request_fail(request, "SPICE_CAPABILITY_MISSING", "SPICE display geometry or inputs are unavailable");
        return FALSE;
    }
    if (!number_member(args, "x", &x) || !number_member(args, "y", &y)) {
        request_fail(request, "INVALID_ARGUMENT", "Drag target coordinates must be finite numbers");
        return FALSE;
    }
    if (g_strcmp0(string_member(args, "coordinateSpace"), "normalized") == 0) {
        if (x < 0 || x > 1 || y < 0 || y > 1) {
            request_fail(request, "INVALID_ARGUMENT", "Normalized drag coordinates must be between 0 and 1");
            return FALSE;
        }
        px = (gint) llround(x * state->display_width);
        py = (gint) llround(y * state->display_height);
    } else if (g_strcmp0(string_member(args, "coordinateSpace"), "pixels") == 0
               && number_member(args, "width", &width) && number_member(args, "height", &height)
               && floor(x) == x && floor(y) == y && floor(width) == width && floor(height) == height
               && width > 0 && height > 0 && x >= 0 && y >= 0 && x <= width && y <= height) {
        px = (gint) llround(x / width * state->display_width);
        py = (gint) llround(y / height * state->display_height);
    } else {
        request_fail(request, "INVALID_ARGUMENT", "Drag coordinates require a valid coordinate space and dimensions");
        goto cleanup;
    }
    spice_main_channel_request_mouse_mode(state->main_channel, SPICE_MOUSE_MODE_CLIENT);
    spice_inputs_channel_position(state->inputs_channel, 0, 0, 0, state->button_state);
    spice_inputs_channel_button_press(state->inputs_channel, SPICE_MOUSE_BUTTON_LEFT,
                                      state->button_state | left_mask);
    state->button_state |= left_mask;
    pressed = TRUE;
    spice_inputs_channel_position(state->inputs_channel, px, py, 0, state->button_state);
    spice_inputs_channel_button_release(state->inputs_channel, SPICE_MOUSE_BUTTON_LEFT,
                                         state->button_state & ~left_mask);
    state->button_state &= ~left_mask;
    pressed = FALSE;
    request->drag_mouse_released = TRUE;
    request_succeed(request);
    return TRUE;

cleanup:
    if (pressed && state->inputs_channel != NULL && state->inputs_open) {
        spice_inputs_channel_button_release(state->inputs_channel, SPICE_MOUSE_BUTTON_LEFT,
                                             state->button_state & ~left_mask);
        state->button_state &= ~left_mask;
        request->drag_mouse_released = TRUE;
    }
    return FALSE;
}

static JsonNode *request_result(Request *request, HelperState *state) {
    JsonBuilder *builder = json_builder_new();
    JsonNode *result;
    json_builder_begin_object(builder);
    if (g_strcmp0(request->operation, "status") == 0) {
        json_builder_end_object(builder);
        json_node_free(json_builder_get_root(builder));
        g_object_unref(builder);
        return status_result(state);
    }
    if (g_strcmp0(request->operation, "clipboard.read") == 0) {
        json_builder_set_member_name(builder, "text"); json_builder_add_string_value(builder, request->clipboard_text != NULL ? request->clipboard_text : "");
        json_builder_set_member_name(builder, "bytes"); json_builder_add_int_value(builder, (gint64) request->clipboard_bytes);
    } else if (g_strcmp0(request->operation, "file.transfer") == 0) {
        json_builder_set_member_name(builder, "transportCompleted"); json_builder_add_boolean_value(builder, TRUE);
        json_builder_set_member_name(builder, "bytes"); json_builder_add_int_value(builder, (gint64) request->transferred_bytes);
    } else if (g_strcmp0(request->operation, "drag-drop") == 0) {
        json_builder_set_member_name(builder, "transferCompleted"); json_builder_add_boolean_value(builder, request->drag_transfer_completed);
        json_builder_set_member_name(builder, "mouseReleased"); json_builder_add_boolean_value(builder, request->drag_mouse_released);
        json_builder_set_member_name(builder, "applicationAccepted"); json_builder_add_string_value(builder, "unknown");
        json_builder_set_member_name(builder, "evidence");
        json_builder_begin_array(builder);
        json_builder_add_string_value(builder, "SPICE file-transfer completion observed");
        json_builder_add_string_value(builder, "SPICE pointer release observed");
        json_builder_end_array(builder);
    } else {
        json_builder_set_member_name(builder, "backend"); json_builder_add_string_value(builder, "spice");
        json_builder_set_member_name(builder, "completed"); json_builder_add_boolean_value(builder, TRUE);
        if (g_strcmp0(request->operation, "mouse") == 0) {
            json_builder_set_member_name(builder, "display"); json_builder_add_int_value(builder, 0);
            json_builder_set_member_name(builder, "width"); json_builder_add_int_value(builder, state->display_width);
            json_builder_set_member_name(builder, "height"); json_builder_add_int_value(builder, state->display_height);
        }
    }
    json_builder_end_object(builder);
    result = json_builder_get_root(builder);
    g_object_unref(builder);
    return result;
}

static void handle_line(HelperState *state, const gchar *line) {
    JsonParser *parser = json_parser_new();
    JsonNode *root = NULL;
    JsonObject *object;
    JsonObject *args;
    const gchar *id;
    const gchar *operation;
    const gchar *domain;
    const gchar *uri;
    const gchar *transport;
    Request *request;
    gboolean success = FALSE;
    GError *error = NULL;
    if (strlen(line) > MAX_LINE_BYTES || !json_parser_load_from_data(parser, line, -1, &error)) {
        emit_error("", "INVALID_ARGUMENT", "Invalid or oversized JSONL request");
        g_clear_error(&error);
        g_object_unref(parser);
        return;
    }
    root = json_parser_get_root(parser);
    if (!JSON_NODE_HOLDS_OBJECT(root)) {
        emit_error("", "INVALID_ARGUMENT", "The helper request must be a JSON object");
        g_object_unref(parser);
        return;
    }
    object = json_node_get_object(root);
    id = string_member(object, "id");
    operation = string_member(object, "operation");
    domain = string_member(object, "domain");
    JsonNode *display_node = json_object_get_member(object, "display");
    JsonObject *display = display_node != NULL && JSON_NODE_HOLDS_OBJECT(display_node) ? json_node_get_object(display_node) : NULL;
    uri = string_member(display, "uri");
    transport = string_member(display, "transport");
    if (transport == NULL) transport = "uri";
    args = arguments_object(object);
    if (json_object_get_int_member(object, "version") != PROTOCOL_VERSION || id == NULL || operation == NULL
        || domain == NULL || uri == NULL || args == NULL
        || (g_strcmp0(transport, "uri") == 0 && !g_str_has_prefix(uri, "spice://"))
        || (g_strcmp0(transport, "libvirt-fd") == 0 && g_strcmp0(uri, "spice+libvirt-fd://local") != 0)
        || (g_strcmp0(transport, "uri") != 0 && g_strcmp0(transport, "libvirt-fd") != 0)) {
        emit_error(id, "INVALID_ARGUMENT", "Invalid version, identity, display endpoint, or arguments");
        g_object_unref(parser);
        return;
    }
    if (!ensure_session(state, domain, uri, transport)) {
        emit_error(id, "SPICE_UNAVAILABLE", "Unable to start the SPICE session");
        g_object_unref(parser);
        return;
    }
    request = g_new0(Request, 1);
    request->state = state;
    request->id = g_strdup(id);
    request->operation = g_strdup(operation);
    state->active = request;
    if (g_strcmp0(operation, "status") == 0) {
        pump_for(state, 1000);
        request_succeed(request);
        success = TRUE;
    } else if (g_strcmp0(operation, "mouse") == 0) {
        success = do_mouse(state, request, args);
    } else if (g_strcmp0(operation, "clipboard.read") == 0 || g_strcmp0(operation, "clipboard.write") == 0) {
        success = do_clipboard(state, request, args);
    } else if (g_strcmp0(operation, "file.transfer") == 0) {
        success = do_file_transfer(state, request, args);
    } else if (g_strcmp0(operation, "drag-drop") == 0) {
        success = do_drag_drop(state, request, args);
    } else {
        request_fail(request, "INVALID_ARGUMENT", "SPICE operation is not allowlisted");
    }
    if (success && request->success) {
        JsonNode *result = request_result(request, state);
        emit_result(request->id, result);
        json_node_free(result);
    } else {
        emit_error(request->id, request->error_code, request->error_message);
    }
    state->active = NULL;
    request_free(request);
    g_object_unref(parser);
}

static void read_line_cb(GObject *source_object, GAsyncResult *result, gpointer user_data) {
    HelperState *state = user_data;
    GError *error = NULL;
    gsize length = 0;
    gchar *line = g_data_input_stream_read_line_finish_utf8(G_DATA_INPUT_STREAM(source_object), result, &length, &error);
    if (line == NULL) {
        g_clear_error(&error);
        g_main_loop_quit(state->loop);
        return;
    }
    if (length > MAX_LINE_BYTES) emit_error("", "INVALID_ARGUMENT", "Input frame exceeds the protocol limit");
    else handle_line(state, line);
    g_free(line);
    g_data_input_stream_read_line_async(state->input, G_PRIORITY_DEFAULT, NULL, read_line_cb, state);
}

int main(void) {
    HelperState state = { 0 };
    GInputStream *stdin_stream = g_unix_input_stream_new(fileno(stdin), FALSE);
    state.loop = g_main_loop_new(NULL, FALSE);
    state.input = g_data_input_stream_new(stdin_stream);
    g_data_input_stream_set_newline_type(state.input, G_DATA_STREAM_NEWLINE_TYPE_LF);
    g_data_input_stream_read_line_async(state.input, G_PRIORITY_DEFAULT, NULL, read_line_cb, &state);
    g_main_loop_run(state.loop);
    clear_session(&state);
    g_clear_object(&state.input);
    g_clear_object(&stdin_stream);
    g_main_loop_unref(state.loop);
    return 0;
}
