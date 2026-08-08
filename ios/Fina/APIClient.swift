import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case http(Int, String)
    case decoding
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .invalidURL: "Некорректный адрес сервера"
        case .http(_, let message): message
        case .decoding: "Не удалось разобрать ответ"
        case .unauthorized: "Нужно войти снова"
        }
    }
}

actor APIClient {
    static let shared = APIClient()

    /// Simulator → host Mac. Override in Settings / UserDefaults key `apiBaseURL`.
    private(set) var baseURL: URL

    init() {
        if let saved = UserDefaults.standard.string(forKey: "apiBaseURL"),
           let url = URL(string: saved) {
            baseURL = url
        } else {
            baseURL = URL(string: "http://127.0.0.1:8787")!
        }
    }

    func setBaseURL(_ string: String) {
        if let url = URL(string: string), !string.isEmpty {
            baseURL = url
            UserDefaults.standard.set(string, forKey: "apiBaseURL")
        }
    }

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        token: String? = nil,
        body: Encodable? = nil
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.http(-1, "Нет ответа")
        }
        if http.statusCode == 401 {
            throw APIError.unauthorized
        }
        if !(200..<300).contains(http.statusCode) {
            let message =
                (try? JSONDecoder().decode(ErrorBody.self, from: data).error)
                ?? String(data: data, encoding: .utf8)
                ?? "Ошибка \(http.statusCode)"
            throw APIError.http(http.statusCode, message)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }

    func login(inviteCode: String, pin: String, memberName: String) async throws -> LoginResponse {
        struct Body: Encodable {
            let inviteCode: String
            let pin: String
            let memberName: String
        }
        return try await request(
            "/auth/login",
            method: "POST",
            body: Body(inviteCode: inviteCode, pin: pin, memberName: memberName)
        )
    }

    func summary(token: String) async throws -> Summary {
        try await request("/summary", token: token)
    }

    func transactions(token: String) async throws -> [Transaction] {
        struct Resp: Decodable { let transactions: [Transaction] }
        let resp: Resp = try await request("/transactions", token: token)
        return resp.transactions
    }

    func createTransaction(
        token: String,
        type: TransactionType,
        amountCents: Int,
        note: String,
        memberId: String?,
        occurredAt: Date?
    ) async throws -> (Transaction, Summary) {
        struct Body: Encodable {
            let type: String
            let amountCents: Int
            let note: String
            let memberId: String?
            let occurredAt: String?
        }
        struct Resp: Decodable {
            let transaction: Transaction
            let summary: Summary
        }
        let iso = occurredAt.map { ISO8601DateFormatter().string(from: $0) }
        let resp: Resp = try await request(
            "/transactions",
            method: "POST",
            token: token,
            body: Body(
                type: type.rawValue,
                amountCents: amountCents,
                note: note,
                memberId: memberId,
                occurredAt: iso
            )
        )
        return (resp.transaction, resp.summary)
    }

    func deleteTransaction(token: String, id: String) async throws -> Summary {
        struct Resp: Decodable {
            let ok: Bool
            let summary: Summary
        }
        let resp: Resp = try await request(
            "/transactions/\(id)",
            method: "DELETE",
            token: token
        )
        return resp.summary
    }

    func share(token: String) async throws -> ShareInfo {
        try await request("/share", token: token)
    }
}

private struct ErrorBody: Decodable {
    let error: String
}

private struct AnyEncodable: Encodable {
    private let encodeFunc: (Encoder) throws -> Void
    init(_ wrapped: Encodable) {
        encodeFunc = wrapped.encode
    }
    func encode(to encoder: Encoder) throws {
        try encodeFunc(encoder)
    }
}
