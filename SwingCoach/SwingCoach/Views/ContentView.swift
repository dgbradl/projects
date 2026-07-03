import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            ShotEntryView()
                .tabItem { Label("New Shot", systemImage: "figure.golf") }
            HistoryView()
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
            TrendsView()
                .tabItem { Label("Trends", systemImage: "chart.bar.fill") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}

#Preview {
    ContentView().environmentObject(ShotStore())
}
