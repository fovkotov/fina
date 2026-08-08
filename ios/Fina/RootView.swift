import SwiftUI

struct RootView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        Group {
            if store.isLoggedIn {
                MainTabView()
            } else {
                LoginView()
            }
        }
        .animation(.smooth(duration: 0.35), value: store.isLoggedIn)
    }
}
