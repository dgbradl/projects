import Foundation

/// Turns a described shot into swing advice using the ball flight laws:
/// the ball starts (mostly) where the clubface points at impact, and it
/// curves away from the swing path. From start line + curve we can infer
/// the face/path relationship, and from that the likely swing fault.
enum DiagnosisEngine {

    static func diagnose(_ shot: Shot, handedness: Handedness) -> Diagnosis {
        // Contact faults dominate — if you didn't hit the middle of the face,
        // fix that before worrying about curvature.
        if shot.contact != .flush {
            return contactDiagnosis(shot)
        }
        return flightDiagnosis(shot, handedness: handedness)
    }

    // MARK: - Flight (start line + curve)

    /// Start line normalized to the golfer: for a right-hander a "pull" starts
    /// left; for a left-hander it starts right. Curve terms (slice/hook) are
    /// already handedness-relative in golf vocabulary, so only this needs mirroring.
    private enum NormalizedStart { case pull, center, push }

    private static func normalizedStart(_ start: StartLine, _ handedness: Handedness) -> NormalizedStart {
        switch (start, handedness) {
        case (.straight, _): return .center
        case (.left, .right), (.right, .left): return .pull
        case (.right, .right), (.left, .left): return .push
        }
    }

    private static func flightDiagnosis(_ shot: Shot, handedness: Handedness) -> Diagnosis {
        let start = normalizedStart(shot.startLine, handedness)
        var d: Diagnosis

        switch (start, shot.curve) {

        case (.center, .straight):
            d = Diagnosis(
                headline: "That's the one! 🎯",
                whatHappened: "Square face, path down the line, center contact. Nothing to fix here.",
                likelyCauses: [],
                fixes: ["Pay attention to what this swing felt like — tempo, grip pressure, balance — so you can repeat it. Good golf is mostly about making your good swing more often, not finding a new one."],
                drills: [],
                isPositive: true
            )

        case (.pull, .slice), (.pull, .fade):
            d = Diagnosis(
                headline: "Pull-slice: the classic over-the-top move",
                whatHappened: "The ball started on your pull side and curved back across — your swing path was cutting sharply across the ball (out-to-in) with the clubface open to that path.",
                likelyCauses: [
                    "Starting the downswing with your shoulders and arms instead of your lower body, throwing the club 'over the top' of the ideal path.",
                    "A grip that's too weak (hands rotated toward the target), leaving the face open.",
                    "Aiming further and further away from your slice side, which makes the across-the-ball path even steeper."
                ],
                fixes: [
                    "Start the downswing from the ground up: feel your lead hip turn open while your back stays to the target a beat longer.",
                    "Check your grip — you should see 2–3 knuckles on your lead hand at address.",
                    "Feel like you swing out toward your push side ('in-to-out'), like hitting the inside-back quadrant of the ball."
                ],
                drills: [Drills.headcover, Drills.gripCheck, Drills.pump]
            )

        case (.center, .slice), (.center, .fade):
            d = Diagnosis(
                headline: shot.curve == .slice ? "Slice: face open to your path" : "Fade: face slightly open to your path",
                whatHappened: "The ball started at the target but curved away — the clubface was open relative to your swing path at impact, putting sidespin on the ball.",
                likelyCauses: [
                    "A weak grip or 'holding on' through impact instead of letting the forearms rotate and square the face.",
                    "Slightly out-to-in path with an open face.",
                    "With the driver: gripping too tightly and steering rather than releasing the club."
                ],
                fixes: [
                    "Strengthen your lead-hand grip slightly (rotate it away from the target until you see 2–3 knuckles).",
                    "Feel like your trail forearm rolls over your lead forearm through impact — like skipping a stone.",
                    "Lighten your grip pressure to about 4/10 so the club can release."
                ],
                drills: [Drills.gripCheck, Drills.splitHand, Drills.gate]
            )
            if shot.curve == .fade {
                d = softened(d, note: "A consistent fade is a perfectly good shot shape — many pros play one. Only chase this if the curve is costing you distance or fairways.")
            }

        case (.push, .slice), (.push, .fade):
            d = Diagnosis(
                headline: "Push-slice: face wide open",
                whatHappened: "The ball started on your push side and kept curving further away — the clubface was open to both your target and your swing path. This is a face-control problem more than a path problem.",
                likelyCauses: [
                    "The clubface never squared up: weak grip, cupped lead wrist at the top, or no forearm rotation through impact.",
                    "Sliding your hips toward the target without rotating, leaving the club trapped behind you with an open face."
                ],
                fixes: [
                    "Fix the grip first — this shot almost always improves with a stronger lead-hand grip.",
                    "At the top of the backswing, feel the back of your lead wrist flat (like it could balance a tray).",
                    "Feel the toe of the club pass the heel through impact."
                ],
                drills: [Drills.gripCheck, Drills.splitHand, Drills.motorcycle]
            )
            if shot.curve == .fade {
                d = softened(d, note: "Since the curve was mild, this is a small miss — a grip check and a bit more face rotation through impact usually straightens it out quickly.")
            }

        case (.push, .hook), (.push, .draw):
            d = Diagnosis(
                headline: shot.curve == .hook ? "Push-hook: too much in-to-out" : "Draw: in-to-out with a slightly closed face",
                whatHappened: "The ball started on your push side and curved back — your path was traveling in-to-out with the clubface closed relative to that path.",
                likelyCauses: [
                    "Swinging too much from the inside — often an overcorrection after fighting a slice.",
                    "A grip that's too strong, or overly active hands flipping the face closed.",
                    "Hanging back on your trail side so the club swings excessively out to the right (for a righty)."
                ],
                fixes: [
                    "Feel like your chest keeps rotating through impact so the club can swing back to the left (for a righty) after the ball.",
                    "Quiet the hands: feel like the back of your lead hand faces the target longer through the hitting zone.",
                    "Check that your grip isn't too strong — more than 3 knuckles visible on the lead hand is a red flag."
                ],
                drills: [Drills.gate, Drills.gripCheck, Drills.feetTogether]
            )
            if shot.curve == .draw {
                d = softened(d, note: "A push-draw that finishes at the target is the shot most golfers dream about. If it's starting too far out or curving too much, use the fixes above to tame it — otherwise keep it!")
            }

        case (.pull, .hook), (.pull, .draw):
            d = Diagnosis(
                headline: "Pull-hook: closed face, path across",
                whatHappened: "The ball started on your pull side and curved even further — the clubface was closed to your target and closed to your path. This is the 'snap hook' pattern and it usually shows up under pressure or with fast tempo.",
                likelyCauses: [
                    "A very strong grip combined with an over-the-top path.",
                    "Flipping or rolling the hands hard through impact (often from slowing your body rotation).",
                    "Ball position too far forward, catching the face after it has closed."
                ],
                fixes: [
                    "Keep your body turning through the shot — the hook happens when the body stalls and the hands take over.",
                    "Weaken your grip slightly and hold your finish: chest facing the target, club over your lead shoulder.",
                    "Check ball position: for irons it should be near the middle of your stance, not up by your lead foot."
                ],
                drills: [Drills.feetTogether, Drills.holdFinish, Drills.gripCheck]
            )

        case (.pull, .straight):
            d = Diagnosis(
                headline: "Straight pull: everything aimed across",
                whatHappened: "The ball flew dead straight but on your pull side — face and path matched each other, just both pointed the wrong way. Often this is aim, not swing.",
                likelyCauses: [
                    "Shoulders aligned across your target line at address (very common — feet aim right, shoulders aim left).",
                    "A mild over-the-top move with a face that matches the path.",
                    "Ball position creeping too far forward, so you catch the ball as the club arcs back inside."
                ],
                fixes: [
                    "Lay a club or alignment stick along your toe line and another at your target — check both feet AND shoulders.",
                    "Feel like the club approaches from inside the target line and exits out toward your push side.",
                    "Move ball position back one ball-width and see if the start line straightens."
                ],
                drills: [Drills.alignmentSticks, Drills.gate]
            )

        case (.push, .straight):
            d = Diagnosis(
                headline: "Straight push: swinging out with a matched face",
                whatHappened: "The ball flew straight but started and stayed on your push side — path in-to-out with the face square to that path. Usually a body-rotation or ball-position issue.",
                likelyCauses: [
                    "Sliding the hips toward the target instead of rotating, trapping the club behind you.",
                    "Ball position too far back in your stance, catching the ball too early in the arc.",
                    "Alignment: aimed at the push side without realizing it."
                ],
                fixes: [
                    "Feel like your belt buckle faces the target at impact — rotate, don't slide.",
                    "Move ball position forward one ball-width.",
                    "Check alignment with sticks before assuming it's the swing."
                ],
                drills: [Drills.alignmentSticks, Drills.holdFinish]
            )

        case (.center, .hook), (.center, .draw):
            d = Diagnosis(
                headline: shot.curve == .hook ? "Hook from the target line: face closing hard" : "Draw from the target line",
                whatHappened: "The ball started at the target and curved away to your draw side — face closed relative to path at impact.",
                likelyCauses: [
                    "Strong grip or very active hand rotation through the ball.",
                    "Body rotation stalling, letting the club flip past you."
                ],
                fixes: [
                    "Keep the chest turning through impact so the hands don't take over.",
                    "Feel like you hold the face square a beat longer through the hitting zone."
                ],
                drills: [Drills.holdFinish, Drills.gripCheck]
            )
            if shot.curve == .draw {
                d = softened(d, note: "A small draw that starts at the target and falls slightly left (for a righty) is a strong ball flight. Only work on this if it's curving off your intended line.")
            }
        }

        return withTrajectoryNote(d, shot: shot)
    }

    // MARK: - Contact

    private static func contactDiagnosis(_ shot: Shot) -> Diagnosis {
        let d: Diagnosis
        switch shot.contact {

        case .fat:
            d = Diagnosis(
                headline: "Fat contact: the low point is behind the ball",
                whatHappened: "The club bottomed out before it reached the ball, so the ground stole most of your speed. The low point of the swing has to be at or slightly in front of the ball.",
                likelyCauses: [
                    "Weight hanging back on the trail foot through impact.",
                    "Releasing the club early ('casting'), so it bottoms out behind the ball.",
                    "Ball position too far forward for the club, or trying to 'help' the ball into the air."
                ],
                fixes: [
                    "At impact roughly 80% of your weight should be over your lead foot — feel like you finish your swing with the trail heel fully off the ground.",
                    "Trust the loft: hit DOWN on the ball with irons; the club gets it airborne, not a scoop.",
                    "Set up with slightly more weight on your lead side (55/45) and keep it there on short shots."
                ],
                drills: [Drills.towelBehind, Drills.divotForward, Drills.feetTogether]
            )

        case .thin:
            d = Diagnosis(
                headline: "Thin contact: catching the ball on the way up",
                whatHappened: "The leading edge struck the middle of the ball — the club's low point was behind the ball or you rose out of your posture before impact.",
                likelyCauses: [
                    "Standing up / straightening the legs through impact ('early extension').",
                    "Trying to lift or scoop the ball into the air.",
                    "Ball too far forward, or weight falling back at the strike.",
                    "Interestingly, thin and fat are the same fault — a low point behind the ball. Slightly less bad timing gives you thin instead of fat."
                ],
                fixes: [
                    "Keep your chest bent over the ball through impact — feel 'covering' the ball with your chest.",
                    "Get your weight to the lead side early in the downswing.",
                    "Keep your trail shoulder moving down and through, not up and out."
                ],
                drills: [Drills.wallButt, Drills.towelBehind, Drills.divotForward]
            )

        case .topped:
            d = Diagnosis(
                headline: "Topped it: the club barely clipped the crown of the ball",
                whatHappened: "The clubhead met the top half of the ball — usually because your body or arms pulled up and away before impact, raising the whole swing arc.",
                likelyCauses: [
                    "Anxiety to see the result: lifting the head and chest early.",
                    "Arms bending ('chicken wing') through impact, shortening the arc.",
                    "Trying to lift the ball instead of hitting down and through it."
                ],
                fixes: [
                    "Keep your sternum over the ball and stay in your posture until well after impact — watch the club actually strike the ball.",
                    "Feel like your arms stay long and stretched through the hitting zone.",
                    "Brush the grass: on practice swings, make the club audibly brush the turf at the ball position."
                ],
                drills: [Drills.brushGrass, Drills.wallButt, Drills.feetTogether]
            )

        case .toe:
            d = Diagnosis(
                headline: "Toe strike: the club came up short of the ball",
                whatHappened: "Contact was out on the toe of the face, which costs ball speed and usually adds hook spin (gear effect).",
                likelyCauses: [
                    "Pulling the arms in toward your body through impact.",
                    "Standing too far from the ball at address.",
                    "Losing posture — hips backing away from the ball on the downswing."
                ],
                fixes: [
                    "Check your setup distance: hands should hang naturally below your shoulders.",
                    "Feel like the clubhead stays 'out' over the ball through impact rather than being pulled inward.",
                    "Maintain your spine angle — chest stays over the ball."
                ],
                drills: [Drills.teeGate, Drills.wallButt]
            )

        case .heel:
            d = Diagnosis(
                headline: "Heel strike: the club moved out toward the ball",
                whatHappened: "Contact was in on the heel — the clubhead got farther from you at impact than it was at address.",
                likelyCauses: [
                    "Early extension: hips thrusting toward the ball, pushing the hands and club outward.",
                    "Standing too close to the ball.",
                    "Weight rolling onto your toes during the downswing."
                ],
                fixes: [
                    "Feel your weight in the middle of your feet, even slightly toward the heels, at setup.",
                    "Keep your trail hip back — feel like your belt buckle stays away from the ball as you rotate.",
                    "Give yourself a touch more room at address."
                ],
                drills: [Drills.teeGate, Drills.wallButt]
            )

        case .shank:
            d = Diagnosis(
                headline: "Shank: contact off the hosel",
                whatHappened: "The ball hit the rounded hosel where the shaft meets the face, squirting sharply toward your push side. The club moved a couple of inches farther from you between address and impact — it's a heel strike's angrier cousin, and it's very fixable.",
                likelyCauses: [
                    "Hips and torso thrusting toward the ball on the downswing (early extension).",
                    "Weight falling toward your toes.",
                    "An excessively in-to-out or out-to-in path that presents the hosel first.",
                    "Standing too close, or grip pressure spiking under tension."
                ],
                fixes: [
                    "Don't panic — shanks come from a small setup/pivot issue, not a broken swing.",
                    "Keep your weight back toward your heels and your trail hip 'sitting' back as you swing down.",
                    "Feel like you're trying to hit the inside-half of the ball with the TOE of the club."
                ],
                drills: [Drills.teeGate, Drills.wallButt, Drills.brushGrass]
            )

        case .flush:
            // Unreachable — flush contact goes through flightDiagnosis.
            d = Diagnosis(headline: "Flush", whatHappened: "", likelyCauses: [], fixes: [], drills: [], isPositive: true)
        }

        return withTrajectoryNote(withCurveFootnote(d, shot: shot), shot: shot)
    }

    // MARK: - Add-on notes

    /// When contact was poor AND the ball still curved a lot, note the curve as the next thing to work on.
    private static func withCurveFootnote(_ d: Diagnosis, shot: Shot) -> Diagnosis {
        guard shot.curve == .slice || shot.curve == .hook else { return d }
        let note = shot.curve == .slice
            ? "You also saw a big slice. Fix the strike first — off-center contact exaggerates curve — then if the slice persists on flush strikes, work on grip and path."
            : "You also saw a big hook. Fix the strike first, then if the hook persists on flush strikes, check your grip strength and keep the body rotating through impact."
        return Diagnosis(
            headline: d.headline,
            whatHappened: d.whatHappened,
            likelyCauses: d.likelyCauses,
            fixes: d.fixes + [note],
            drills: d.drills,
            isPositive: d.isPositive
        )
    }

    private static func withTrajectoryNote(_ d: Diagnosis, shot: Shot) -> Diagnosis {
        var extra: String?
        switch shot.trajectory {
        case .low where shot.contact == .flush && !d.isPositive:
            extra = "The low flight suggests the ball may be too far back in your stance, or you're delofting the face with your hands well ahead — check ball position first."
        case .high where shot.contact == .flush && !d.isPositive:
            extra = shot.club == .driver
                ? "Ballooned driver flight usually means too much spin — often from hitting down on it. Tee it higher, ball off your lead heel, and feel like you hit slightly up on it."
                : "The ballooned flight suggests the club is adding loft at impact — usually a scooping motion. Feel your hands lead the clubhead through the ball."
        default:
            break
        }
        guard let extra else { return d }
        return Diagnosis(
            headline: d.headline,
            whatHappened: d.whatHappened,
            likelyCauses: d.likelyCauses,
            fixes: d.fixes + [extra],
            drills: d.drills,
            isPositive: d.isPositive
        )
    }

    /// Mild shot shapes (draw/fade) get an encouraging footnote rather than a scolding.
    private static func softened(_ d: Diagnosis, note: String) -> Diagnosis {
        Diagnosis(
            headline: d.headline,
            whatHappened: d.whatHappened,
            likelyCauses: d.likelyCauses,
            fixes: [note] + d.fixes,
            drills: d.drills,
            isPositive: d.isPositive
        )
    }
}

// MARK: - Drill library

enum Drills {
    static let headcover = Drill(
        name: "Headcover gate",
        howTo: "Place a headcover (or empty water bottle) just outside and slightly behind the ball. Swing without hitting it. An over-the-top path will clobber the headcover; an inside path misses it. Start at half speed."
    )
    static let gripCheck = Drill(
        name: "Grip check",
        howTo: "At address, look down at your lead hand: you should see 2–3 knuckles, and the 'V' between thumb and index finger should point at your trail shoulder. Re-grip 10 times in front of a mirror until it feels normal."
    )
    static let pump = Drill(
        name: "Pump drill",
        howTo: "Take the club to the top, then 'pump' halfway down twice, feeling the club drop behind you and your lead hip open — then hit the ball on the third pump. Trains starting down with the lower body."
    )
    static let splitHand = Drill(
        name: "Split-hand release",
        howTo: "Grip the club with your hands 3–4 inches apart and make slow swings, feeling the trail forearm roll over the lead forearm through impact. Exaggerates the feel of squaring the face."
    )
    static let gate = Drill(
        name: "Tee gate (start line)",
        howTo: "Stick two tees in the ground one clubhead-width apart, a foot in front of the ball on your target line. Hit balls through the gate — instant feedback on your start line."
    )
    static let motorcycle = Drill(
        name: "Motorcycle drill",
        howTo: "From the top of the backswing, feel like you're revving a motorcycle throttle DOWN with your lead wrist (bowing it). This closes the face early so you don't need a last-second flip."
    )
    static let feetTogether = Drill(
        name: "Feet-together swings",
        howTo: "Hit half-speed shots with your feet touching. Impossible to do with a lunging or sliding swing — it forces rotation, balance, and centered contact."
    )
    static let holdFinish = Drill(
        name: "Hold the finish",
        howTo: "Hit balls at 75% speed and hold your finish for a full 3 seconds: chest at the target, trail heel up, in balance. If you can't hold it, the swing was out of sequence."
    )
    static let towelBehind = Drill(
        name: "Towel behind the ball",
        howTo: "Lay a folded towel about one grip-length behind the ball. Hit shots without touching the towel — forces the low point of your swing forward, curing fat and thin strikes."
    )
    static let divotForward = Drill(
        name: "Divot in front of the line",
        howTo: "Draw a chalk/tee line on the turf. Make practice swings trying to start your divot ON or just in front of the line, never behind it. Then hit balls doing the same."
    )
    static let wallButt = Drill(
        name: "Wall drill (keep your hips back)",
        howTo: "Set up with your rear end just touching a wall (or a chair/bag). Make slow swings keeping contact with the wall through impact. Cures early extension — the root of thins, heels, and shanks."
    )
    static let brushGrass = Drill(
        name: "Brush the grass",
        howTo: "Make continuous practice swings focusing on the club brushing the grass at the ball position every single time. Then put a ball in the way and make the same swing — the ball is just in the way of a good swing."
    )
    static let teeGate = Drill(
        name: "Two-tee strike gate",
        howTo: "Place a tee just outside the toe and another just inside the heel of the club at address, with the ball in the middle. Hit the ball without hitting either tee. Instant feedback on where the strike is."
    )
    static let alignmentSticks = Drill(
        name: "Alignment sticks",
        howTo: "Lay one stick along your toe line and one just outside the ball pointing at the target. Check feet, hips, AND shoulders match the toe-line stick. Do this every range session — aim drifts without feedback."
    )
}
