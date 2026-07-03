import SwiftUI

struct SettingsView: View {
    @AppStorage("handedness") private var handedness: Handedness = .right
    @AppStorage("anthropicAPIKey") private var apiKey: String = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Golfer") {
                    Picker("I play", selection: $handedness) {
                        ForEach(Handedness.allCases) { Text($0.rawValue).tag($0) }
                    }
                }

                Section {
                    SecureField("Anthropic API key (optional)", text: $apiKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("AI coach")
                } footer: {
                    Text("Optional. Paste an Anthropic API key (from console.anthropic.com) to add a personalized AI coach to each diagnosis. The built-in analysis works fully offline without it. The key is stored only on this device.")
                }

                Section("About") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("SwingCoach").font(.headline)
                        Text("Describe what your ball did and get a diagnosis of the likely swing fault, based on the ball flight laws: the ball starts roughly where the clubface points, and curves away from the swing path.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            }
            .navigationTitle("Settings")
        }
    }
}

#Preview {
    SettingsView()
}
