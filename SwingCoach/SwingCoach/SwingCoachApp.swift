import SwiftUI

@main
struct SwingCoachApp: App {
    @StateObject private var store = ShotStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
    }
}
