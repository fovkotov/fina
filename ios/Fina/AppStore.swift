import Foundation
import Observation
import SwiftUI

@Observable
@MainActor
final class AppStore {
    var token: String? {
        didSet { UserDefaults.standard.set(token, forKey: "token") }
    }
    var member: Member? {
        didSet {
            if let member, let data = try? JSONEncoder().encode(member) {
                UserDefaults.standard.set(data, forKey: "member")
            } else {
                UserDefaults.standard.removeObject(forKey: "member")
            }
        }
    }
    var summary: Summary?
    var transactions: [Transaction] = []
    var shareInfo: ShareInfo?
    var isLoading = false
    var errorMessage: String?
    var apiBaseURL: String

    var isLoggedIn: Bool { token != nil && member != nil }

    init() {
        token = UserDefaults.standard.string(forKey: "token")
        if let data = UserDefaults.standard.data(forKey: "member") {
            member = try? JSONDecoder().decode(Member.self, from: data)
        }
        apiBaseURL =
            UserDefaults.standard.string(forKey: "apiBaseURL")
            ?? (ProcessInfo.processInfo.environment["FINA_API_URL"]
                ?? "https://fina-api.fovkotov.workers.dev")
    }

    func login(inviteCode: String, pin: String, memberName: String) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            await APIClient.shared.setBaseURL(apiBaseURL)
            let response = try await APIClient.shared.login(
                inviteCode: inviteCode,
                pin: pin,
                memberName: memberName
            )
            token = response.token
            member = response.member
            summary = response.summary
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        guard let token else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            await APIClient.shared.setBaseURL(apiBaseURL)
            async let s = APIClient.shared.summary(token: token)
            async let t = APIClient.shared.transactions(token: token)
            async let sh = APIClient.shared.share(token: token)
            summary = try await s
            transactions = try await t
            shareInfo = try await sh
        } catch APIError.unauthorized {
            logout()
            errorMessage = "Сессия истекла — войди снова"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func addTransaction(
        type: TransactionType,
        amount: Double,
        note: String,
        memberId: String?,
        date: Date
    ) async -> Bool {
        guard let token else { return false }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let cents = Int((amount * 100).rounded())
            let result = try await APIClient.shared.createTransaction(
                token: token,
                type: type,
                amountCents: cents,
                note: note,
                memberId: memberId,
                occurredAt: date
            )
            summary = result.1
            await refresh()
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func deleteTransaction(_ id: String) async {
        guard let token else { return }
        do {
            summary = try await APIClient.shared.deleteTransaction(token: token, id: id)
            transactions.removeAll { $0.id == id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func logout() {
        token = nil
        member = nil
        summary = nil
        transactions = []
        shareInfo = nil
    }
}
