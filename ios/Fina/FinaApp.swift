import SwiftUI

@main
struct FinaApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
    }

    private func handleDeepLink(_ url: URL) {
        guard url.scheme == "fina" else { return }
        if url.host == "add" {
            let type = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first(where: { $0.name == "type" })?
                .value ?? "deposit"
            NotificationCenter.default.post(
                name: .finaQuickAdd,
                object: nil,
                userInfo: ["type": type]
            )
        }
    }
}
