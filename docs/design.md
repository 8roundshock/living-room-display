# Quiet visual hierarchy

Reviewed 2026-10-18 for [#34](https://github.com/8roundshock/living-room-display/issues/34).
Apple's Human Interface Guidelines inform this web interface; this is an original
implementation for a wide living-room display, not an Apple platform replica.
No Apple assets, SF font downloads, glass materials, or platform libraries are used.

| Primary guidance | Application here |
| --- | --- |
| [Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets): glanceable content; StandBy enlarges content and removes its background. | Quiet black widget surfaces, large time/temperature, short reminder titles, and no empty reminder widget by default. |
| [Layout](https://developer.apple.com/design/human-interface-guidelines/layout): alignment and deliberate hierarchy support scanning. | Shared editor section insets and spacing, subordinate widget behavior controls, stable relationships inside each moving group. |
| [Typography](https://developer.apple.com/design/human-interface-guidelines/typography): legibility and size/weight communicate importance. | System font stack, sturdier main numerals, sentence-case labels with restrained tracking, clear editor headings. Primary values lead; supporting details remain smaller. |
| [Motion](https://developer.apple.com/design/human-interface-guidelines/motion): purposeful, optional motion that avoids distraction. | Brief color feedback on controls and a soft reveal when a widget appears. No bouncing, extra interaction delays, or animated decoration. Reduced motion removes these transitions and widget motion. |
| [Always On](https://developer.apple.com/design/human-interface-guidelines/always-on): keep key content legible and dim secondary information. | Brightness applies only to content over `#000`; forecast age is quieter than current values, and there are no filled ambient cards. |

The owner's requirement for whole widgets to drift and periodically move between
distinct areas takes precedence over Apple's recommendation to keep Always On
layouts stable. Four compositions and calm fades remain; disabling movement or
using reduced motion gives a static layout. Hiding an empty reminder group leaves
its region black, without moving neighboring content unexpectedly. This design
does not claim to prevent OLED image retention or reproduce Apple power behavior.

The editor remains more legible than the ambient display. Room/Night brightness
defaults and the existing brightness range are unchanged. Readability on a TV at
the user's viewing distance still requires actual setup verification; browser
viewport checks alone do not establish it.

Recheck these choices when typography, widget content, composition geometry or
motion changes, or when relevant upstream HIG guidance changes. This is a dated
design reference, not a scheduled review or a vendor certification.
