import Foundation

/// Persists shots as a JSON file in the app's Documents directory.
@MainActor
final class ShotStore: ObservableObject {
    @Published private(set) var shots: [Shot] = []

    private let fileURL: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("shots.json")
    }()

    init() {
        load()
    }

    func add(_ shot: Shot) {
        shots.insert(shot, at: 0)
        save()
    }

    func delete(at offsets: IndexSet) {
        shots.remove(atOffsets: offsets)
        save()
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode([Shot].self, from: data) else { return }
        shots = decoded
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(shots) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }
}
