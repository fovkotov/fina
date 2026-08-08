import Foundation

enum TransactionType: String, Codable, CaseIterable, Identifiable {
    case deposit
    case withdrawal
    case interest
    case cashback

    var id: String { rawValue }

    var title: String {
        switch self {
        case .deposit: "Внесение"
        case .withdrawal: "Списание"
        case .interest: "Проценты"
        case .cashback: "Кэшбэк"
        }
    }

    var isNegative: Bool { self == .withdrawal }

    var systemImage: String {
        switch self {
        case .deposit: "arrow.down.circle.fill"
        case .withdrawal: "arrow.up.circle.fill"
        case .interest: "percent"
        case .cashback: "creditcard.fill"
        }
    }
}

struct Member: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let accent: String
    var balanceCents: Int?

    enum CodingKeys: String, CodingKey {
        case id, name, accent
        case balanceCents
    }
}

struct Summary: Codable {
    let householdId: String
    let name: String
    let inviteCode: String
    let totalCents: Int
    let contributionsCents: Int
    let interestCents: Int
    let cashbackCents: Int
    let accrualsCents: Int
    let members: [Member]
}

struct Transaction: Codable, Identifiable {
    let id: String
    let type: TransactionType
    let amountCents: Int
    let note: String
    let occurredAt: String
    let createdAt: String?
    let memberId: String?
    let memberName: String?
    let memberAccent: String?
    let createdByName: String?
}

struct LoginResponse: Codable {
    let token: String
    let expiresAt: String
    let household: HouseholdInfo
    let member: Member
    let summary: Summary
}

struct HouseholdInfo: Codable {
    let id: String
    let name: String
    let inviteCode: String
}

struct ShareInfo: Codable {
    let householdName: String
    let inviteCode: String
    let webUrl: String
    let members: [String]
    let hint: String
}

enum Money {
    static func format(_ cents: Int) -> String {
        let value = Double(cents) / 100.0
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "RUB"
        formatter.currencySymbol = "₽"
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 2
        formatter.locale = Locale(identifier: "ru_RU")
        return formatter.string(from: NSNumber(value: value)) ?? "\(value) ₽"
    }

    static func shortDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: iso)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: iso)
        }
        guard let date else { return iso }
        let out = DateFormatter()
        out.locale = Locale(identifier: "ru_RU")
        out.dateFormat = "d MMM yyyy"
        return out.string(from: date)
    }
}
