# SwingCoach 🏌️

A personal iPhone app you sideload with Xcode — no App Store needed. Describe what your golf shot did (contact, start line, curve, trajectory) and get an instant diagnosis of the likely swing fault, plus fixes and practice drills.

The analysis is built on the **ball flight laws**: the ball starts roughly where the clubface points at impact, and curves away from the swing path. From what you saw the ball do, the app works backward to what your club — and therefore your swing — was doing.

## Features

- **New Shot** — tap through what happened (club, strike quality, start line, curve, trajectory, optional notes) and get a diagnosis: what happened at impact, the most likely causes ranked, what to work on, and specific drills with instructions.
- **History** — every shot is saved on-device; tap any past shot to re-read its diagnosis, swipe to delete.
- **Trends** — after a few shots, see your most common miss and where practice time will pay off most.
- **Settings** — left/right-handed support, and an optional AI coach (see below).
- Works fully **offline** — no account, no server, all data stays on your phone.

## Requirements

- A Mac with **Xcode 16 or newer** (free from the Mac App Store)
- An iPhone with a Lightning/USB-C cable (or on the same Wi-Fi for wireless deploy)
- A free **Apple ID** (no paid developer account needed)

## Install on your iPhone

1. **Open the project**: double-click `SwingCoach.xcodeproj`.
2. **Set up signing** (one-time):
   - Click the blue **SwingCoach** project icon in the sidebar → select the **SwingCoach** target → **Signing & Capabilities** tab.
   - Check **Automatically manage signing**.
   - Under **Team**, choose **Add an Account…**, sign in with your Apple ID, then select your **Personal Team**.
   - Change the **Bundle Identifier** from `com.example.SwingCoach` to something unique to you, e.g. `com.yourname.SwingCoach`.
3. **Enable Developer Mode on the iPhone** (one-time, iOS 16+): connect the phone, then on the phone go to **Settings → Privacy & Security → Developer Mode**, turn it on, and restart when prompted.
4. **Run**: select your iPhone in the device dropdown at the top of Xcode, then press **⌘R** (Run). Xcode builds the app and installs it on your phone.
5. **Trust the developer** (one-time): if the app won't open, on the phone go to **Settings → General → VPN & Device Management**, tap your Apple ID, and tap **Trust**.

### The 7-day rule (free Apple ID)

Apps signed with a free Apple ID stop launching after **7 days**. To refresh, just plug the phone back in and press ⌘R again — your shot history is preserved. A paid Apple Developer account ($99/yr) extends this to a year, but for personal use the weekly re-run is usually fine.

## Optional: AI coach

The built-in engine covers the classic ball-flight patterns. If you also want free-form, personalized advice:

1. Create an API key at [console.anthropic.com](https://console.anthropic.com) (usage is pay-as-you-go; a piece of advice costs a fraction of a cent).
2. In the app, go to **Settings** and paste the key.
3. Each diagnosis screen gains a **"Get personalized AI advice"** button that sends your shot description (including your free-text notes) to Claude and returns coaching tailored to what you wrote.

The key is stored in the app's local preferences on your phone and is only ever sent to Anthropic's API. Skip this entirely if you don't want it — everything else works without a network connection.

## Project layout

```
SwingCoach/
├── SwingCoach.xcodeproj        Xcode project (open this)
└── SwingCoach/
    ├── SwingCoachApp.swift     App entry point
    ├── Models/Models.swift     Shot, clubs, contact/curve enums, Diagnosis
    ├── Engine/DiagnosisEngine.swift  Ball-flight-laws rules + drill library
    ├── Store/ShotStore.swift   JSON persistence in the app's Documents folder
    ├── AI/AICoach.swift        Optional Anthropic API call
    └── Views/                  SwiftUI screens (entry, diagnosis, history, trends, settings)
```
