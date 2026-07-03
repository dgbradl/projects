import SwiftUI

struct DiagnosisView: View {
    let shot: Shot

    @AppStorage("handedness") private var handedness: Handedness = .right
    @AppStorage("anthropicAPIKey") private var apiKey: String = ""
    @Environment(\.dismiss) private var dismiss

    @State private var aiAdvice: String?
    @State private var aiError: String?
    @State private var aiLoading = false

    private var diagnosis: Diagnosis {
        DiagnosisEngine.diagnose(shot, handedness: handedness)
    }

    var body: some View {
        let d = diagnosis
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(d.headline)
                        .font(.title3.bold())
                    Text(shot.summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }

            if !d.whatHappened.isEmpty {
                Section("What happened at impact") {
                    Text(d.whatHappened)
                }
            }

            if !d.likelyCauses.isEmpty {
                Section("Most likely causes") {
                    ForEach(Array(d.likelyCauses.enumerated()), id: \.offset) { index, cause in
                        Label(cause, systemImage: "\(index + 1).circle.fill")
                    }
                }
            }

            if !d.fixes.isEmpty {
                Section(d.isPositive ? "Keep it going" : "What to work on") {
                    ForEach(d.fixes, id: \.self) { fix in
                        Label(fix, systemImage: "wrench.and.screwdriver")
                    }
                }
            }

            if !d.drills.isEmpty {
                Section("Drills") {
                    ForEach(d.drills) { drill in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(drill.name).font(.headline)
                            Text(drill.howTo).font(.subheadline).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                }
            }

            if !apiKey.isEmpty {
                Section("AI coach") {
                    if let aiAdvice {
                        Text(aiAdvice)
                    } else if aiLoading {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Asking your AI coach…")
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Button {
                            askAI()
                        } label: {
                            Label("Get personalized AI advice", systemImage: "sparkles")
                        }
                        if let aiError {
                            Text(aiError)
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
        }
        .navigationTitle("Diagnosis")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    private func askAI() {
        aiLoading = true
        aiError = nil
        Task {
            do {
                aiAdvice = try await AICoach.advice(for: shot, handedness: handedness, apiKey: apiKey)
            } catch {
                aiError = error.localizedDescription
            }
            aiLoading = false
        }
    }
}

#Preview {
    NavigationStack {
        DiagnosisView(shot: Shot(club: .driver, startLine: .left, curve: .slice, contact: .flush, trajectory: .normal))
    }
}
