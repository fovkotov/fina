import AppIntents
import SwiftUI
import WidgetKit

/// Control Center quick actions (iOS 18+).
/// Add in Control Center → Edit → ФИНА.
/// Double-click Side Button is reserved by Apple Pay — assign these controls
/// to Action Button / Control Center instead, or use Spotlight “Внести в ФИНА”.

struct DepositControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.fina.control.deposit") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "fina://add?type=deposit")!)) {
                Label("Внесение", systemImage: "plus.circle.fill")
            }
        }
        .displayName("ФИНА · Внесение")
        .description("Быстро внести деньги")
    }
}

struct WithdrawalControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.fina.control.withdrawal") {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "fina://add?type=withdrawal")!)) {
                Label("Списание", systemImage: "minus.circle.fill")
            }
        }
        .displayName("ФИНА · Списание")
        .description("Быстро списать деньги")
    }
}

@main
struct FinaControlsBundle: WidgetBundle {
    var body: some Widget {
        DepositControl()
        WithdrawalControl()
    }
}
