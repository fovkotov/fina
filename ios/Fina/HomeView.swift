import SwiftUI

struct HomeView: View {
    @Environment(AppStore.self) private var store
    @Binding var showAdd: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                FinaTheme.background

                ScrollView {
                    VStack(spacing: 18) {
                        totalCard
                        membersRow
                        bucketsRow
                        recentSection
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 100)
                }
            }
            .navigationTitle("ФИНА")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showAdd = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.title2)
                            .symbolEffect(.pulse, options: .repeating.speed(0.4), isActive: true)
                    }
                }
            }
            .refreshable { await store.refresh() }
            .safeAreaInset(edge: .bottom) {
                Button {
                    showAdd = true
                } label: {
                    Label("Добавить операцию", systemImage: "plus")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(FinaTheme.forest)
                .padding(.horizontal, 18)
                .padding(.bottom, 8)
            }
        }
    }

    private var totalCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Всего на счёте")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            Text(Money.format(store.summary?.totalCents ?? 0))
                .font(.system(size: 40, weight: .bold, design: .rounded))
                .foregroundStyle(FinaTheme.ink)
                .contentTransition(.numericText())
                .animation(.snappy, value: store.summary?.totalCents)

            if let me = store.member {
                Text("Ты вошёл как \(me.name)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .finaGlass(cornerRadius: 32)
    }

    private var membersRow: some View {
        HStack(spacing: 12) {
            ForEach(store.summary?.members ?? []) { member in
                VStack(alignment: .leading, spacing: 6) {
                    Text(member.name)
                        .font(.subheadline.weight(.semibold))
                    Text(Money.format(member.balanceCents ?? 0))
                        .font(.system(.title3, design: .rounded).weight(.bold))
                        .minimumScaleFactor(0.7)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(Color(hex: member.accent).opacity(0.18))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .stroke(Color(hex: member.accent).opacity(0.35), lineWidth: 1)
                )
            }
        }
    }

    private var bucketsRow: some View {
        let s = store.summary
        return HStack(spacing: 12) {
            bucket("Проценты", Money.format(s?.interestCents ?? 0), "percent")
            bucket("Кэшбэк", Money.format(s?.cashbackCents ?? 0), "creditcard")
            bucket("Изи мани", Money.format(s?.easyMoneyCents ?? 0), "sparkles")
        }
    }

    private func bucket(_ title: String, _ value: String, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(FinaTheme.forest)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(.footnote, design: .rounded).weight(.bold))
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .finaGlass(cornerRadius: 22)
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Последние операции")
                .font(.headline)
            ForEach(store.transactions.prefix(6)) { tx in
                TransactionRow(tx: tx)
            }
        }
        .padding(18)
        .finaGlass(cornerRadius: 28)
    }
}

struct TransactionRow: View {
    let tx: Transaction

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: tx.type.systemImage)
                .font(.title3)
                .foregroundStyle(tx.type.isNegative ? FinaTheme.clay : FinaTheme.forest)
                .frame(width: 36, height: 36)
                .background(
                    Circle().fill((tx.type.isNegative ? FinaTheme.clay : FinaTheme.forest).opacity(0.12))
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(amountText)
                .font(.system(.subheadline, design: .rounded).weight(.bold))
                .foregroundStyle(tx.type.isNegative ? FinaTheme.clay : FinaTheme.forest)
        }
        .padding(.vertical, 4)
    }

    private var title: String {
        if let name = tx.memberName, !name.isEmpty {
            return "\(name) · \(tx.type.title)"
        }
        return tx.type.title
    }

    private var subtitle: String {
        let note = tx.note.isEmpty ? Money.shortDate(tx.occurredAt) : "\(tx.note) · \(Money.shortDate(tx.occurredAt))"
        return note
    }

    private var amountText: String {
        let sign = tx.type.isNegative ? "−" : "+"
        return "\(sign)\(Money.format(tx.amountCents))"
    }
}

extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&int)
        let r, g, b: UInt64
        switch cleaned.count {
        case 6:
            (r, g, b) = ((int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            (r, g, b) = (47, 111, 94)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: 1
        )
    }
}
