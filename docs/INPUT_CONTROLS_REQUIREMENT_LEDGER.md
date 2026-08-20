# Input-controls requirement ledger

This ledger reconciles the authoritative “Current implementation audit” in
`INPUT_CONTROLS_IMPLEMENTATION_GUIDE.md`. `VERIFIED` means verified at the stated
local or source boundary; it does not imply live VM proof. `IMPLEMENTED-UNVERIFIED-LIVE`
means safe source and local tests exist but the external boundary was not exercised.
`BLOCKED-LIVE` is reserved for the unavailable external boundary.

| ID | Requirement | Implementation | Focused tests | Documentation | External proof needed | Status | Commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P.1 | Preserve the untracked handoff | Working-tree discipline; handoff never staged | Final status audit | README and final report | `git status --short` | VERIFIED | all commits |
| P.2 | Preserve pre-existing `package-lock.json` changes | No lockfile edits or staging | Final staged-name checks | Final report | `git diff -- package-lock.json` | VERIFIED | all commits |
| P.3 | Use shared `virsh.ts`/`libvirt.ts` seam | Existing files retained and extended | `src/libvirt.test.ts` | Project structure in README | Existing lifecycle boundary | VERIFIED | 91af743 |
| P.4 | Use `/home/wellington/env/bin/python` if Python is introduced | No Python introduced | N/A | Final report | N/A | VERIFIED | all commits |
| 1.1 | Capability state is observed, not configuration-only | `src/capabilities.ts` status probes | `src/capabilities.test.ts` | README capability errors | Live libvirt/helper status | VERIFIED | 50f22ec, 0b91744, 5d90a90; live capability snapshot |
| 1.2 | Model unconfigured/configured/connecting/connected/agent-disconnected/capability-missing | `CapabilityState`, SPICE mapping | `src/capabilities.test.ts` | README state definitions | Live channel transitions | VERIFIED | 91af743, 50f22ec; live connected/unconfigured/capability-missing states |
| 1.3 | Parse allowlisted QEMU/display XML facts only | `src/display.ts`, `src/libvirt.ts` | `src/display.test.ts`, `src/capabilities.test.ts` | Evidence matrix | Active-domain XML | VERIFIED | 91af743, 50f22ec; active `ubuntu24.04` XML |
| 1.4 | Probe QMP commands and absolute pointer | `src/qmp.ts` | `src/qmp.test.ts`, `src/mouse.test.ts` | Evidence matrix | Live QMP query | VERIFIED | 1a4bb98; live query and input test |
| 1.5 | Native status reports channels/mode/agent/capabilities | `native/spice-helper.c`, `src/spice.ts` | `src/spice.test.ts`, `src/native-helper.test.ts` | Protocol and matrix | Real SPICE session | VERIFIED | e01dd47, d1b291a; Omarchy status observed all channels and 1280x800 geometry |
| 1.6 | Distinguish compiled/configured/connected/agent-dependent support | `src/capabilities.ts`, helper path checks | capability/status tests | README and matrix | Live dependency and guest state | VERIFIED | 50f22ec; live dependency/state snapshot |
| 2.1 | Public screenshot backends only `auto`/`libvirt` | `src/screenshot.ts`, `src/tools.ts` | `src/screenshot.test.ts` | README examples | Live disposable screenshot | VERIFIED | 5f27878; live `virsh screenshot` |
| 2.2 | Exact virsh args and confined temp output | `src/screenshot.ts` | screenshot argument/cleanup tests | README security | Live `virsh screenshot` | VERIFIED | 5f27878; live `virsh screenshot` |
| 2.3 | Success/failure/timeout/size/format/screen/cleanup tests | `src/screenshot.test.ts` | Same focused suite | Evidence matrix | Live failure and success | VERIFIED | 5f27878; live success plus focused failure tests |
| 2.4 | Correct MCP image content and no temp-path leak | `src/tools.ts`, `src/screenshot.ts` | screenshot handler tests | Evidence document | Live image capture | VERIFIED | 5f27878; live screenshot returned non-empty image |
| 2.5 | Bounded PPM handling; no unnecessary conversion | `src/screenshot.ts` | PPM/signature tests | README | Live format observation | VERIFIED | 5f27878; live screenshot format validated |
| 3.1 | Finite documented keyboard allowlist | `src/keyboard.ts` canonical table | `src/keyboard.test.ts` | README and evidence doc | Live harmless key | VERIFIED | 38f83cc; live `ESC` |
| 3.2 | Case/duplicate/modifier/length/hold/timeout/error policy | `src/keyboard.ts` | keyboard validation/failure tests | Evidence doc | Live harmless sequence | VERIFIED | 38f83cc; live `ESC` plus focused failure tests |
| 3.3 | One canonical table drives runtime/tests/docs | `keyboardKeyTable`, exported allowlist | table-size/mapping test | Complete allowlist in docs | Live key mapping | IMPLEMENTED-UNVERIFIED-LIVE | 38f83cc |
| 3.4 | Document guest-layout limitation | README and evidence doc | N/A | README/evidence doc | Guest layout observation | VERIFIED | ac2ef8b |
| 4.1 | Typed QMP query responses and absolute pointer requirement | `src/qmp.ts` | QMP probe tests | Evidence matrix | Live QMP query | VERIFIED | 1a4bb98, 0b91744; live query |
| 4.2 | Discriminated mouse schemas | `src/tools.ts`, `src/mouse.ts` | mouse parser tests | Evidence doc | Live input | IMPLEMENTED-UNVERIFIED-LIVE | 1a4bb98 |
| 4.3 | Reject malformed coordinates/buttons/deltas/batches | `src/validation.ts`, `src/qmp.ts` | validation/QMP/mouse tests | Evidence doc | Live negative boundary | VERIFIED | 1a4bb98, 0b91744 |
| 4.4 | Return backend/display/head identity | `src/mouse.ts`, typed SPICE result | mouse tests | Evidence examples | Live backend selection | VERIFIED | 50f22ec; live QMP result identified backend/head |
| 4.5 | Remove unsafe standalone button state operations | `MouseAction` only move/click/scroll | mouse rejection test | Evidence doc | Live click cleanup | VERIFIED | 1a4bb98 |
| 4.6 | Exact QMP ordering/conversion/scroll/failure tests | `src/qmp.ts`, `src/mouse.ts` | QMP/mouse suites | Evidence matrix | Live target | IMPLEMENTED-UNVERIFIED-LIVE | 1a4bb98 |
| 5.1 | Small native C helper with available libraries | `native/spice-helper.c`, `native/Makefile` | `npm run test:spice-helper` | README dependencies | Real channel | VERIFIED | e01dd47, d1b291a; native helper built and opened Omarchy through libvirt graphics FDs |
| 5.2 | Persistent process/session keyed by domain+endpoint | `src/spice.ts`, native session state | spice/native-helper tests | Protocol docs | Endpoint/reconnect live proof | IMPLEMENTED-UNVERIFIED-LIVE | 38561cd, e01dd47 |
| 5.3 | Typed status/mouse/clipboard/file operations | `SpiceOperation` union and native dispatch | spice/native-helper tests | Protocol docs | Real operation boundaries | IMPLEMENTED-UNVERIFIED-LIVE | 38561cd, e01dd47 |
| 5.4 | JSONL IDs/limits/progress/parse errors | TS client/native framing | spice/native-helper tests | Protocol docs | Real helper session | IMPLEMENTED-UNVERIFIED-LIVE | 38561cd, e01dd47 |
| 5.5 | Timeouts/cancellation/channel lifecycle/reconnect/crash handling | TS pending map; native cancellable/session cleanup | spice lifecycle tests | README troubleshooting | Real disconnect/reconnect | IMPLEMENTED-UNVERIFIED-LIVE | 38561cd, e01dd47, 0b91744 |
| 5.6 | Sensitive-data-safe logging | No payload logging in helper/client | Source inspection/local helper | README security | Host process audit | VERIFIED | e01dd47 |
| 5.7 | No arbitrary helper/protocol passthrough | Fixed executable, empty argv, typed union | spice framing tests | README security | Adversarial MCP call | VERIFIED | 38561cd |
| 6.1 | SPICE inputs position/motion/button press/release | Native `do_mouse` | mouse/status tests | Evidence doc | Real inputs channel | VERIFIED | e01dd47, d1b291a; live normalized move completed on Omarchy inputs channel |
| 6.2 | Validate mode/channel readiness | Status preflight and typed result | `src/mouse.test.ts`, `src/spice.test.ts` | Evidence doc | Live status transition | VERIFIED | 50f22ec, 0b91744, d1b291a; live status reported connected channels, client mouse mode, and geometry |
| 6.3 | Correct masks and release cleanup | Native click/drag masks | drag reducer/native build | Evidence doc | Live interrupted gesture | IMPLEMENTED-UNVERIFIED-LIVE | 7c97c11, 0b91744 |
| 6.4 | Auto selection and no mid-operation fallback | `src/mouse.ts` | mouse/status tests | README | Live SPICE/QMP selection | IMPLEMENTED-UNVERIFIED-LIVE | 50f22ec |
| 6.5 | Fake-helper ordering/cancel/crash coverage | `src/spice.test.ts`, mouse tests | Local helper suite | Evidence matrix | Live helper crash/disconnect | IMPLEMENTED-UNVERIFIED-LIVE | 38561cd, 50f22ec |
| 7.1 | Real agent connectivity/capabilities/grab/request/notify/release | Native callbacks and `clipboard.ts` reducer | `src/clipboard.test.ts` | Evidence doc | Live guest agent | IMPLEMENTED-UNVERIFIED-LIVE | 91b8aa8, 7c97c11 |
| 7.2 | UTF-8 only; reject unsupported/oversized/invalid data | Native and TS byte/UTF-8 checks | clipboard tests | README limits | Live malformed guest data | IMPLEMENTED-UNVERIFIED-LIVE | 91b8aa8, 7c97c11 |
| 7.3 | Independent TS result validation | `clipboardResultForTest` and handler | clipboard result tests | Evidence doc | Live round-trip | IMPLEMENTED-UNVERIFIED-LIVE | 91b8aa8 |
| 7.4 | Independently test reducer fixtures | `reduceClipboardState` | clipboard reducer tests | Evidence matrix | Live signal sequence | VERIFIED | 91b8aa8 |
| 7.5 | Round trips and disconnected-agent error | Opt-in harness and manual env gate | `src/integration.test.ts` | README instructions | Both directions; manual agent disconnect | BLOCKED-LIVE | 9b7d77e |
| 8.1 | Confined canonical readable regular source | `src/transfer.ts`, native no-follow check | `src/transfer.test.ts` | Evidence doc | Live source/guest destination | IMPLEMENTED-UNVERIFIED-LIVE | b89910a, 7c97c11, d1b291a; source confinement and 46-byte transport exercised, guest destination not inspected |
| 8.2 | Async SPICE file copy/progress/cancellable/timeout/bytes | Native file-copy callbacks | native build/local helper; transfer tests | Protocol/evidence docs | Live transfer | VERIFIED | b89910a, 7c97c11, d1b291a; live SPICE file copy reported exact completion and byte count |
| 8.3 | No submission-only success or automatic uncertain retry | Exact completion validation | transfer result tests | Evidence doc | Live partial failure | VERIFIED | b89910a |
| 8.4 | Success/rejection/cancel/disconnect/timeout/duplicate/crash fixtures | TS/helper lifecycle tests | spice/transfer suites | Matrix | Live transfer failures | IMPLEMENTED-UNVERIFIED-LIVE | b89910a, 38561cd |
| 8.5 | Real transfer and destination semantics | Opt-in `transferFile` test | integration harness | Evidence doc | Disposable Linux guest | IMPLEMENTED-UNVERIFIED-LIVE | 9b7d77e, d1b291a; real transport completed, but the SPICE API did not expose/verify guest destination semantics |
| 9.1 | Require all channels/file-transfer before drag | `src/drag-drop.ts` preflight | drag tests | Evidence doc | Live SPICE status | VERIFIED | 7c97c11, d1b291a; live preflight observed required channels and transfer capability |
| 9.2 | Resolve geometry and destination before events | Native geometry/TS coordinates | drag parser tests | Evidence doc | Live display geometry | VERIFIED | 7c97c11, d1b291a; live 1280x800 geometry and normalized target were accepted |
| 9.3 | Explicit transfer/pointer/progress/cancel state machine | TS reducer and native sequence | drag reducer tests | Evidence doc | Live harness | IMPLEMENTED-UNVERIFIED-LIVE | 7c97c11, 0b91744 |
| 9.4 | Guarantee release after partial failure | Native cleanup branch and state evidence | drag failure test | Evidence doc | Interrupted live gesture | IMPLEMENTED-UNVERIFIED-LIVE | 7c97c11, 0b91744 |
| 9.5 | Separate transfer/release/application/evidence fields | `validateDragResult` | drag evidence tests | Examples/matrix | Live app evidence | VERIFIED | 7c97c11, d1b291a; live result separated transfer, release, unknown acceptance, and evidence |
| 9.6 | Only claim observable application acceptance | Always `unknown` without harness | drag evidence test | README/docs | Real target app | BLOCKED-LIVE | 7c97c11 |
| 9.7 | Viewer harness only with explicit dependency/authorization | No package install; experimental raw sequence | N/A | README limitation | remote-viewer/desktop harness | BLOCKED-LIVE | 7c97c11 |
| 10.1 | Require exactly three live safety variables | `src/integration.test.ts` | Default skipped/incomplete gate | README/docs | Explicit disposable VM | VERIFIED | 9b7d77e |
| 10.2 | Never choose first VM or infer disposable | Explicit `BOXES_TEST_VM` only | Harness source inspection | README/docs | Live test run | VERIFIED | 9b7d77e |
| 10.3 | Exercise all boundaries where available | Screenshot/key/QMP/SPICE/clipboard/transfer/drag tests | Opt-in integration suite | Evidence matrix | Live run and versions | VERIFIED | 9b7d77e, d1b291a; Omarchy run: 7 passed, clipboard and manual disconnect honestly skipped |
| 10.4 | Record QEMU/libvirt/SPICE/guest versions and states | Harness/docs recording fields | Integration output when enabled | Evidence doc | Live environment capture | VERIFIED | 9b7d77e, d1b291a; live versions and graphics-FD capability snapshot below |
| 10.5 | Preserve exact libvirt blocker and continue safe work | Documented command/error | Native/local suites | Evidence doc | Working libvirt socket | VERIFIED | ac2ef8b, d1b291a; `domdisplay` error retained and graphics-FD path exercised |
| 11.1 | MCP examples for every implemented operation | Evidence document | N/A | Evidence document | N/A | VERIFIED | ac2ef8b |
| 11.2 | Document allowlist/layout/coords/backends/limits/dependencies/troubleshooting | README and evidence document | N/A | README/docs | N/A | VERIFIED | ac2ef8b |
| 11.3 | Document actually exercised environments | Evidence matrix and live result | N/A | Evidence document | Future live run update | VERIFIED | ac2ef8b |
| 11.4 | Maintain separate unit/local/libvirt/QMP/SPICE/agent/app evidence | Evidence matrix | N/A | Evidence document | Future boundary proof | VERIFIED | ac2ef8b |
| 11.5 | Avoid unsupported live claims | Wording uses pending/blocked/unknown | N/A | README/docs/final report | Review against live evidence | VERIFIED | ac2ef8b |

The remaining `BLOCKED-LIVE` rows are external-boundary results, not omitted source
work. The exact errors and the required next environment are recorded in
`INPUT_CONTROLS_EVIDENCE.md`.
