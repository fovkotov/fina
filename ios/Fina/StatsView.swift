import SwiftUI

struct StatsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        NavigationStack {
            ZStack {
                FinaTheme.background
                ScrollView {
                    VStack(spacing: 16) {
                        if let summary = store.summary {
                            ForEach(summary.members) { member in
                                statCard(
                                    title: member.name,
                                    value: Money.format(member.balanceCents ?? 0),
                                    detail: "чистый вклад",
                                    color: Color(hex: member.accent)
                                )
                            }

                            statCard(
                                title: "Вклады вместе",
                                value: Money.format(summary.contributionsCents),
                                detail: "без процентов и кэшбэка",
                                color: FinaTheme.ink
                            )
                            statCard(
                                title: "Изи мани",
                                value: Money.format(summary.accrualsCents),
                                detail: "\(Money.format(summary.interestCents)) % · \(Money.format(summary.cashbackCents)) кэшбэк",
                                color: FinaTheme.forest
                            )

                            let deposits = store.transactions.filter { $0.type == .deposit }.count
                            let withdrawals = store.transactions.filter { $0.type == .withdrawal }.count
                            statCard(
                                title: "Операции",
                                value: "\(store.transactions.count)",
                                detail: "\(deposits) внесений · \(withdrawals) списаний",
                                color: .secondary
                            )
                        }
                    }
                    .padding(18)
                }
            }
            .navigationTitle("Статистика")
            .refreshable { await store.refresh() }
        }
    }

    private func statCard(title: String, value: String, detail: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(color)
            Text(value)
                .font(.system(size: 28, weight: .bold, design: .rounded))
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .finaGlass(cornerRadius: 26)
    }
}
