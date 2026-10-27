---
project: "RozdzielnicaPro"
version: 2
status: draft
created: 2026-09-15
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

An installer electrician, after meeting the client and analysing the existing installation, already knows the number of circuits (obwody), the planned loads and what was agreed with the client — but translates that into a device layout in the switchboard (rozdzielnica) by hand, "by eye". This leads to uneconomical solutions (long cable runs, messy wiring), layouts that may not follow good installation practice, improvisation on site at the client's, and makes it hard to quickly work out an adequate labour quote.

Combining manufacturer catalog data for devices (dimensions, price) with the geometry of a specific switchboard cabinet and simple heuristic rules makes it possible to propose a layout automatically that is at once convenient to install, standards-compliant and economical in wiring — without building a heavyweight, professional electrical CAD tool. Existing solutions of this class are too complex for simple home installations; the goal is a simple, deliberately industry-limited planning and quoting assistant, also built as a learning project for its author.

## User & Persona

An **installer electrician** (elektryk instalator) carrying out simple electrical installations in single-family houses. At the start of the MVP: the project's author alone, as a single named user (an electrician in the process of gaining further qualifications), with the option of extending to other installers in the future.

They reach for the tool **after meeting the client and analysing the existing installation/design**, when they already know the number of circuits and the planned loads — to plan a concrete switchboard layout ahead of time (without improvising on the installation site) and to prepare a quick, adequate labour quote.

## Success Criteria

### Primary

- The electrician can get from creating a project to a generated labour quote for a real, simple installation — receiving a concrete cabinet design/layout along the way (not just a number) — without manual calculation in a spreadsheet.

### Secondary

- The proposed device layout needs only spot manual corrections, not building from scratch.

### Guardrails

- The quote and the device selection must always be consistent with the given circuit parameters — the system never proposes a device that fails the circuit's parameters (e.g. too low a rated current); a wrong suggestion is worse than no suggestion. When no device in the catalog satisfies a circuit's parameters, the system reports an error asking the user to contact the administrator, instead of falling back to a non-compliant device.

## User Stories

### US-01: The electrician plans a switchboard and gets a quote

- **Given** a signed-in electrician and a device catalog and cabinet catalog maintained by the admin
- **When** they create a new project, pick a cabinet from the catalog, enter the OSD/WLZ parameters and the circuits brought to the cabinet together with their assignment to RCD groups
- **Then** they receive a proposed set of devices (the cheapest among those satisfying the circuit parameters) and a proposed layout of them in the cabinet, which they can correct, and then generate a printable quote containing the cabinet layout, the material cost and the labour cost calculated at their hourly rate

#### Acceptance Criteria

- Suggested devices always satisfy the given circuit parameters (a device with too low parameters is never proposed)
- When no device in the catalog satisfies the parameters of some circuit, the electrician sees an error asking them to contact the administrator, not a proposal of a non-compliant device
- The proposed layout is editable before the quote is generated
- The estimated labour time is visible and can be overridden before the quote is finalised
- The exported/printed quote contains a cost breakdown (material + labour) and a clear visualisation of the cabinet layout

## Functional Requirements

### Admin — catalog

- FR-001: The admin can add and edit supported devices together with manufacturer data (dimensions, catalog price, electrical parameters needed to match a device to a circuit). Priority: must-have
  > Socratic: Counter-argument considered: none — this is the foundation the rest of the system rests on (without a catalog there is no device selection or layout). Resolution: kept unchanged.
- FR-002: The admin can add and edit switchboard cabinets together with their dimensions and mounting rail layout, building a cabinet catalog. Priority: must-have
  > Socratic: Counter-argument considered: 2-3 starter cabinets may be too similar to show differences in the layout. Resolution: kept, with an explicit note on content — the 2-3 starter cabinets must differ substantially (size / number of rails) so that the layout heuristic visibly adapts to them.

### Electrician (`elektryk`) — installation project

- FR-003: The electrician can create a new project. Priority: must-have
  > Socratic: Counter-argument considered: none — trivial, but a necessary container for steps 4-8. Resolution: kept unchanged.
- FR-004: The electrician can pick a cabinet for the project from the cabinet catalog maintained by the admin. Priority: must-have
  > Socratic: Counter-argument considered: limiting the choice to catalog cabinets (no custom/non-standard cabinet) narrows real-world use beyond the demo. Resolution: kept for the MVP — a deliberate scope narrowing; the name was unified from "example cabinets" to "cabinet catalog", so that the mechanism (FR-002) and its consumer (FR-004) use the same language.
- FR-005: The electrician can enter, for the project, the OSD connection parameters (pre-meter protection, installation system: TN-C / TN-S / TN-C-S / TT, number of phases) and the WLZ parameters (length, cross-section and material, installation method: surface-mounted / in conduit / in the ground, etc.), for the purpose of simple validation and selection of the main protection devices. Priority: must-have
  > Socratic: Counter-argument considered: none — this data is a direct input to correct selection of main protection (FR-007) and to validation; without it further suggestions would be unfounded. Resolution: kept, with the field list written out explicitly at the user's direction.
- FR-006: The electrician can enter the number and parameters of the circuits brought to the cabinet and indicate which circuits share a common residual-current group (RCD, wyłącznik różnicowoprądowy). Priority: must-have
  > Socratic: Counter-argument considered: none — a direct input to FR-007. Resolution: kept unchanged; templates/copying circuits between projects deferred to a later version.
- FR-007: The system suggests devices that satisfy the given circuit parameters; among the matching ones, the default selection and sorting criterion is the lowest catalog price. Priority: must-have
  > Socratic: Counter-argument considered: "lowest price" alone is too narrow a criterion — the electrician may want a preferred manufacturer instead of a mix of brands in one cabinet. Resolution: for the MVP the lowest price among correct matches is kept; a preferred-manufacturer filter is noted as a possible extension in a later version, not required in the MVP.
- FR-008: The system proposes an automatic layout of the selected devices in the chosen cabinet, applying simple heuristic rules (not a full optimisation algorithm). Priority: must-have
  > Socratic: Counter-argument considered: a bad heuristic is worse than no suggestion if the electrician has to redo it completely. Resolution: kept, but flagged as a risk to be settled concretely (not left vague) — the exact heuristic rules are defined in `## Business Logic`, precisely because "standards compliance" must be reduced to a short, explicit list of rules so that it can be built in the MVP.
- FR-009: The electrician can manually modify the proposed layout. Priority: must-have
  > Socratic: Counter-argument considered: none — this is the safety net for an imperfect heuristic (FR-008); without it a bad suggestion blocks the whole project. Resolution: kept unchanged.

### Electrician (`elektryk`) — quote

- FR-010: The electrician can configure quote parameters in their profile: the hourly rate, the average mounting time per device (a single averaged statistical value for all devices, not a separate time per model) and a fixed time overhead per project. Priority: must-have
  > Socratic: Counter-argument considered: none. Resolution: kept unchanged; a single rate is enough for the MVP. Added during PRD validation — the time parameters of the estimate are an attribute of the electrician's profile, not a field in the device catalog nor a global system constant, so each electrician calibrates the quote to their own working pace.
- FR-011: The system estimates labour time and cost for the quote based on the project (the number of selected devices multiplied by the average mounting time per device from the electrician's profile, plus the fixed per-project overhead); the estimate is a starting point that the electrician can override before the quote is finalised — it is never presented as a final, non-editable value. Priority: must-have
  > Socratic: Counter-argument considered: a labour estimate "pulled out of thin air" is worse than no estimate — it undermines trust in the tool. Resolution: kept, with the override behaviour written explicitly into the FR itself; the concrete basis of the estimate (what drives it) is defined in `## Business Logic`.
- FR-012: The electrician can export/print a quote document that contains a clear visualisation of the cabinet layout design, not just the price. Priority: must-have
  > Socratic: Counter-argument considered: without a clear layout visualisation the printout is only a list of line items and loses value compared with an ordinary invoice. Resolution: kept unchanged — the visualisation is a required part of the exported document, not an optional extra.
- FR-013: The system compiles the material cost from the catalog prices of the selected devices and shows it in the quote next to the labour cost. Priority: must-have

## Non-Functional Requirements

- The suggested device set, the layout proposal and the quote appear without noticeable waiting for a catalog of this scale (on the order of single seconds, not tens of seconds).
- Projects and client data belonging to a given electrician are visible only to them — no other user can see someone else's projects.
- The whole user interface is in Polish — including error messages, validations and the printed quote — because at the start the application targets Polish clients and uses Polish industry terminology (obwód, rozdzielnica, wyłącznik różnicowoprądowy, szyna PE/N).
- The text layer is prepared for localisation: user-visible texts are not hard-coded in components but come from a separate translation source, so that adding another language does not require rewriting the views. Translation into another language itself is **not a goal of the MVP** — the goal is not to block it.
- Dates, numbers and amounts (PLN) are formatted according to the user's locale, not with a fixed format — consistent with the rule of storing and processing dates in UTC and presenting them in local time only at the end.

## Business Logic

**The system selects and places devices so as to satisfy the circuit parameters with the minimum cable length.**

The rule consumes the data entered by the electrician: the OSD/WLZ parameters, the list of circuits together with their grouping into residual-current groups (RCD) — when entering circuits the electrician indicates which circuits share a common RCD — and the cabinet chosen from the catalog (its layout of mounting rails/tracks).

The result is a set of suggested devices (satisfying the circuit parameters, with the lowest price among the matching ones) and a proposal for their physical placement in the cabinet. The placement applies three rules together: **(1) grouping** — the overcurrent circuit breakers (MCBs) of a given group sit next to its RCD, and if an RCD group covers only one circuit, the system suggests a single RCBO (combined RCD + overcurrent breaker) instead of two separate devices; **(2) proximity of cable entries** — the group is placed as close as possible to the side of the cabinet from which its circuits' cables enter (top, left, right, bottom); **(3) proximity of shared elements** — the placement accounts for the distance to the PE and N bars (szyny PE i N). Together these three rules are what the MVP uses to approximate "minimum cable length"; they remain a heuristic applied directly, not a global optimisation. When no device in the catalog satisfies the given parameters of some circuit, the rule does not fall back to a non-compliant device — the system reports an error asking the user to contact the administrator, because the missing device is a gap in the catalog that the admin fills in (FR-001).

The quote is built on the same basis: the number of selected devices multiplied by the average mounting time per device — a parameter from the electrician's profile, next to the hourly rate, a single averaged value for all devices — increased by a fixed per-project overhead (preparing the cabinet, connecting the WLZ) gives the estimated working time; that time multiplied by the hourly rate gives the labour cost, and the catalog prices of the selected devices give the material cost. The electrician meets these rules on the project planning screen: they see the proposed device set and the visual layout in the cabinet, can correct the layout (FR-009) and override the estimated time (FR-011) before generating the quote.

## Access Control

Sign-in with email + password. No email address verification in the MVP.

Two roles:

| Role         | Permissions                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **admin**    | Manages the catalog of supported devices (manufacturer data: dimensions, catalog price, etc.) and the catalog of switchboard cabinets. Has no access to the electricians' projects or client data.                                                                  |
| **elektryk** | Creates their own installation projects, picks a cabinet, receives a device layout proposal, generates a quote; configures in their profile the hourly rate, the average mounting time per device and the fixed per-project overhead. Sees only their own projects. |

Electrician accounts can be created in two ways: self-registration or account creation by the admin — both modes are allowed in the MVP.

A signed-out user reaching a protected route is redirected to sign-in.

## Non-Goals

- **No full layout optimisation algorithm** — the MVP uses a simple heuristic (RCD grouping, proximity of cable entries, proximity of PE/N bars — see `## Business Logic`), not a solver or combinatorial optimisation.
- **No device types outside the list supported in the MVP** — the MVP supports only: switch-disconnectors ("FR" — without fuse links; clarified 2026-09-23 while planning S-01), residual-current devices (RCD), residual-current devices with overcurrent protection (RCBO), type-B overcurrent circuit breakers, PE bars and N bars, and since 2026-10-09 also 1F/3F comb busbars (listwy zasilające) for feeding RCD groups. Other types — including distribution blocks (considered for the proximity rules, but not included in the MVP) and overcurrent circuit breakers with characteristics other than B — come only after the MVP, if it goes easily and time remains.
- **No bulk/automatic import of the manufacturer catalog** — the admin adds devices and cabinets manually in the MVP; integration with real manufacturer databases is not a goal of the MVP.
- **No payment / invoice integration** — the quote is an informational document for printing/export, not an invoice tied to a payment system.
- **No support for touch screens / mobile devices** — the MVP assumes work on a computer (mouse + keyboard); there is no dedicated touch UI.
- **No full, theoretical standards-compliant metering** — the MVP does simple validations based on the data entered (see FR-005, FR-007), not full engineering/certification calculations of compliance with the standard.
- **No large-scale/commercial installations** — the MVP targets only single-family houses and flats, not industrial/commercial buildings.
- **No multiple switchboards in one project** — one project corresponds to one cabinet; linked/multi-switchboard installations are out of the MVP's scope.

Note (not a non-goal, a scope clarification): single-phase (1F) and three-phase (3F) installations are to be supported in the MVP — this is not excluded (see FR-005: number of phases as an OSD field).

## Open Questions

1. **Acceptance criteria for the admin path** — FR-001 and FR-002 have no user story or acceptance criteria; the whole admin role is undescribed in terms of behaviour. Owner: user. Block: no (but it makes writing a test for this path harder).
2. ~~How to resolve a conflict between placement rules?~~ — resolved 2026-10-06, see below. (The number stays so that references from the roadmap do not drift.)
3. **FR-013 did not go through the Socratic round** — added after the challenge round, during PRD validation; not confronted with a counter-argument like the other FRs. Owner: user. Block: no.
4. **Which submission deadline ultimately applies: 4 November 2026 or 6 December 2026?** — The target is 4 November, but without pressure; if the 3-week MVP estimate is exceeded, a move to 6 December is acceptable without cutting scope. That is why the frontmatter records `hard_deadline: null`. Owner: user. Block: no.

**Resolved during validation:**

- _(2026-10-09)_ The MVP device-type scope extended with 1F/3F comb busbars (listwy zasilające) for feeding RCD groups (roadmap S-12, GitHub #17) — the 2026-09-16 narrowing remains in force for the other types; see `## Non-Goals`.
- _(2026-10-06)_ Precedence of the placement rules when they point to different places for the same group: (1) grouping > (2) proximity of cable entries > (3) proximity of PE/N bars. Recorded in the header of `src/lib/cabinet-layout.ts`; see `## Business Logic`.
- _(2026-09-15)_ Source of device mounting time — an averaged, statistical parameter of the electrician's profile (next to the hourly rate), not a field in the device catalog and not a global system constant; see FR-010 and `## Business Logic`.
- _(2026-09-16)_ No matching device in the catalog — the system reports an error asking the user to contact the administrator, instead of falling back to a non-compliant device; see the guardrail in `## Success Criteria`, `## Business Logic` and the acceptance criteria of US-01.
- _(2026-09-16)_ RCD grouping is not enough to realise "minimum cable length" — the heuristic additionally covers proximity of cable entries to the cabinet (top/left/right/bottom) and proximity of the PE and N bars; see `## Business Logic`.
- _(2026-09-16)_ MVP device-type scope narrowed to: switch-disconnectors ("FR", without fuse links — clarified 2026-09-23 while planning S-01), RCD, RCBO, type-B overcurrent breakers, PE bars, N bars; see `## Non-Goals`.
- _(2026-09-16)_ Orders of magnitude of load and data — `qps: low`, `data_volume: small`: one electrician, project work (a few to a dozen or so projects per month), device and cabinet catalog maintained manually by the admin. The scale fits with a wide margin within the free limits of the chosen stack; see the frontmatter `target_scale` and `context/foundation/tech-stack.md`.
