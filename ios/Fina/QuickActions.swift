import UIKit
import SwiftUI

enum FinaQuickAction: String {
    case deposit = "com.fina.deposit"
    case withdrawal = "com.fina.withdrawal"

    @MainActor
    static func register() {
        UIApplication.shared.shortcutItems = [
            UIApplicationShortcutItem(
                type: FinaQuickAction.deposit.rawValue,
                localizedTitle: "Внесение",
                localizedSubtitle: "Добавить деньги",
                icon: UIApplicationShortcutIcon(systemImageName: "arrow.down.circle.fill"),
                userInfo: nil
            ),
            UIApplicationShortcutItem(
                type: FinaQuickAction.withdrawal.rawValue,
                localizedTitle: "Списание",
                localizedSubtitle: "Убрать деньги",
                icon: UIApplicationShortcutIcon(systemImageName: "arrow.up.circle.fill"),
                userInfo: nil
            ),
        ]
    }

    static func handle(_ item: UIApplicationShortcutItem) {
        switch item.type {
        case FinaQuickAction.deposit.rawValue:
            NotificationCenter.default.post(
                name: .finaQuickAdd,
                object: nil,
                userInfo: ["type": "deposit"]
            )
        case FinaQuickAction.withdrawal.rawValue:
            NotificationCenter.default.post(
                name: .finaQuickAdd,
                object: nil,
                userInfo: ["type": "withdrawal"]
            )
        default:
            break
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        FinaQuickAction.register()
        if let item = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                FinaQuickAction.handle(item)
            }
        }
        return true
    }

    func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        FinaQuickAction.handle(shortcutItem)
        completionHandler(true)
    }
}
