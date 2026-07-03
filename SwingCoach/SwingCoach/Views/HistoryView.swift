import SwiftUI

struct HistoryView: View {
    @EnvironmentObject private var store: ShotStore

    var body: some View {
        NavigationStack {
            Group {
                if store.shots.isEmpty {
                    ContentUnavailableView(
                        "No shots yet",
                        systemImage: "figure.golf",
                        description: Text("Describe a shot on the New Shot tab and it will show up here.")
                    )
                } else {
                    List {
                        ForEach(store.shots) { shot in
                            NavigationLink {
                                DiagnosisView(shot: shot)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(shot.summary)
                                        .font(.subheadline)
                                    Text(shot.date, format: .dateTime.month().day().hour().minute())
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .onDelete { store.delete(at: $0) }
                    }
                }
            }
            .navigationTitle("Shot history")
        }
    }
}

#Preview {
    HistoryView().environmentObject(ShotStore())
}
