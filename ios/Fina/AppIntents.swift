import AppIntents
import Foundation
import SwiftUI

enum QuickTxType: String, AppEnum {
    case deposit
    case withdrawal

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "Тип операции")
    }

    static var caseDisplayRepresentations: [QuickTxType: DisplayRepresentation] {
        [
            .deposit: "Внесение",
            .withdrawal: "Списание",
        ]
    }
}

struct AddMoneyIntent: AppIntent {
    static var title: LocalizedStringResource { "Добавить в ФИНА" }
    static var description: IntentDescription {
        IntentDescription("Быстро внести или списать деньги на совместном счёте")
    }
    static var openAppWhenRun: Bool { true }

    @Parameter(title: "Тип")
    var type: QuickTxType

    @Parameter(title: "Сумма")
    var amount: Double

    @Parameter(title: "Комментарий", default: "")
    var note: String

    static var parameterSummary: some ParameterSummary {
        Summary("\(\.$type) \(\.$amount) ₽") {
            \.$note
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let token = UserDefaults.standard.string(forKey: "token") else {
            return .result(dialog: "Сначала войди в ФИНА")
        }
        let api = APIClient.shared
        let cents = Int((amount * 100).rounded())
        guard cents > 0 else {
            return .result(dialog: "Сумма должна быть больше нуля")
        }
        let txType: TransactionType = type == .deposit ? .deposit : .withdrawal
        _ = try await api.createTransaction(
            token: token,
            type: txType,
            amountCents: cents,
            note: note,
            memberId: nil,
            occurredAt: Date()
        )
        NotificationCenter.default.post(name: .finaNeedsRefresh, object: nil)
        let verb = type == .deposit ? "Внесено" : "Списано"
        return .result(dialog: "\(verb) \(Money.format(cents))")
    }
}

struct FinaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddMoneyIntent(),
            phrases: [
                "Внести в \(.applicationName)",
                "Списать в \(.applicationName)",
                "Добавить операцию в \(.applicationName)",
            ],
            shortTitle: "Операция ФИНА",
            systemImageName: "plus.circle.fill"
        )
    }
}

extension Notification.Name {
    static let finaNeedsRefresh = Notification.Name("finaNeedsRefresh")
    static let finaQuickAdd = Notification.Name("finaQuickAdd")
}
