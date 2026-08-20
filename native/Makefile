CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra -Wpedantic
PKGS = spice-client-glib-2.0 json-glib-1.0 gio-unix-2.0

all: boxes-spice-helper

boxes-spice-helper: spice-helper.c
	$(CC) $(CFLAGS) spice-helper.c -o $@ $$(pkg-config --cflags --libs $(PKGS)) -lm

clean:
	rm -f boxes-spice-helper

.PHONY: all clean
