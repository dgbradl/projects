import SwiftUI

struct ShotEntryView: View {
    @EnvironmentObject private var store: ShotStore
    @State private var shot = Shot()
    @State private var showDiagnosis = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Club") {
                    Picker("Club", selection: $shot.club) {
                        ForEach(Club.allCases) { Text($0.rawValue).tag($0) }
                    }
                }

                Section("Contact — how did the strike feel?") {
                    ChoiceGrid(selection: $shot.contact, options: Contact.allCases)
                }

                Section("Where did it start?") {
                    Picker("Start line", selection: $shot.startLine) {
                        ForEach(StartLine.allCases) { Text($0.short).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }

                Section("How did it curve?") {
                    ChoiceGrid(selection: $shot.curve, options: Curve.allCases)
                }

                Section("Trajectory") {
                    Picker("Trajectory", selection: $shot.trajectory) {
                        ForEach(Trajectory.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Anything else? (optional)") {
                    TextField("e.g. felt like I swung too hard…", text: $shot.note, axis: .vertical)
                        .lineLimit(2...4)
                }

                Section {
                    Button {
                        shot.date = Date()
                        store.add(shot)
                        showDiagnosis = true
                    } label: {
                        Text("Analyze my shot")
                            .frame(maxWidth: .infinity)
                            .font(.headline)
                    }
                    .buttonStyle(.borderedProminent)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
            }
            .navigationTitle("Describe your shot")
            .sheet(isPresented: $showDiagnosis, onDismiss: resetForNextShot) {
                NavigationStack {
                    DiagnosisView(shot: shot)
                }
            }
        }
    }

    private func resetForNextShot() {
        // Keep the club (you usually hit several with the same one), reset the rest.
        let club = shot.club
        shot = Shot()
        shot.club = club
    }
}

/// A tappable grid of options — faster on-course than wheel pickers.
struct ChoiceGrid<Option: Identifiable & Equatable & RawRepresentable>: View where Option.RawValue == String {
    @Binding var selection: Option
    let options: [Option]

    private let columns = [GridItem(.adaptive(minimum: 100), spacing: 8)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(options) { option in
                Button {
                    selection = option
                } label: {
                    Text(option.rawValue)
                        .font(.subheadline)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(selection == option ? Color.accentColor : Color(.secondarySystemFill))
                        )
                        .foregroundStyle(selection == option ? .white : .primary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    ShotEntryView().environmentObject(ShotStore())
}
