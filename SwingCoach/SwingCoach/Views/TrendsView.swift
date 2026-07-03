import SwiftUI

/// Looks across recent shots for the pattern that shows up most, so practice
/// time goes to the miss that actually costs strokes.
struct TrendsView: View {
    @EnvironmentObject private var store: ShotStore

    private var recent: [Shot] { Array(store.shots.prefix(50)) }

    private struct PatternCount: Identifiable {
        let id: String
        let label: String
        let count: Int
        let advice: String
    }

    private var patterns: [PatternCount] {
        var counts: [String: (label: String, count: Int, advice: String)] = [:]

        func bump(_ key: String, _ label: String, _ advice: String) {
            let existing = counts[key]?.count ?? 0
            counts[key] = (label, existing + 1, advice)
        }

        for shot in recent {
            if shot.contact != .flush {
                bump("contact.\(shot.contact.rawValue)", shot.contact.rawValue,
                     "Strike quality is your priority — curvature fixes don't stick until contact is consistent. Spend range time on strike drills (towel, tee-gate, brush-the-grass) before anything else.")
            }
            switch shot.curve {
            case .slice:
                bump("curve.slice", "Big slice",
                     "A recurring slice responds fastest to grip and path work: strengthen the lead-hand grip and groove an in-to-out path with the headcover gate drill.")
            case .hook:
                bump("curve.hook", "Big hook",
                     "A recurring hook usually means overactive hands or an overly strong grip. Work on keeping your body rotating through impact — feet-together and hold-the-finish drills.")
            case .fade, .draw, .straight:
                break
            }
            if shot.startLine != .straight && shot.curve == .straight && shot.contact == .flush {
                bump("start.\(shot.startLine.rawValue)", "Straight miss \(shot.startLine.short.lowercased())",
                     "Straight shots that miss the target are often aim, ball position, or alignment — bring alignment sticks to every range session before changing your swing.")
            }
        }

        return counts
            .map { PatternCount(id: $0.key, label: $0.value.label, count: $0.value.count, advice: $0.value.advice) }
            .sorted { $0.count > $1.count }
    }

    private var flushAndStraight: Int {
        recent.filter { $0.contact == .flush && $0.curve == .straight && $0.startLine == .straight }.count
    }

    var body: some View {
        NavigationStack {
            Group {
                if recent.count < 3 {
                    ContentUnavailableView(
                        "Not enough shots yet",
                        systemImage: "chart.bar",
                        description: Text("Log a few more shots and this tab will show your most common miss and what to practice.")
                    )
                } else {
                    List {
                        Section("Last \(recent.count) shots") {
                            HStack {
                                Label("Flush and on target", systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                                Spacer()
                                Text("\(flushAndStraight)")
                                    .bold()
                            }
                        }

                        if let top = patterns.first {
                            Section("Practice priority") {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("\(top.label) — \(top.count)x")
                                        .font(.headline)
                                    Text(top.advice)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 2)
                            }
                        }

                        if patterns.count > 1 {
                            Section("Other recurring misses") {
                                ForEach(patterns.dropFirst()) { p in
                                    HStack {
                                        Text(p.label)
                                        Spacer()
                                        Text("\(p.count)x")
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Trends")
        }
    }
}

#Preview {
    TrendsView().environmentObject(ShotStore())
}
