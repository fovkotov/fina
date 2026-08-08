import SwiftUI

struct MainTabView: View {
    @Environment(AppStore.self) private var store
    @State private var showAdd = false
    @State private var quickType: TransactionType = .deposit
    @State private var showQuick = false

    var body: some View {
        TabView {
            Tab("Главная", systemImage: "house.fill") {
                HomeView(showAdd: $showAdd)
            }
            Tab("Операции", systemImage: "list.bullet.rectangle") {
                TransactionsView()
            }
            Tab("Статистика", systemImage: "chart.bar.fill") {
                StatsView()
            }
            Tab("Ещё", systemImage: "person.2.fill") {
                SettingsView()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tint(FinaTheme.forest)
        .sheet(isPresented: $showAdd) {
            AddTransactionView()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showQuick) {
            QuickAddSheet(type: quickType)
        }
        .task { await store.refresh() }
        .onReceive(NotificationCenter.default.publisher(for: .finaNeedsRefresh)) { _ in
            Task { await store.refresh() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .finaQuickAdd)) { note in
            let raw = note.userInfo?["type"] as? String ?? "deposit"
            quickType = raw == "withdrawal" ? .withdrawal : .deposit
            showQuick = true
        }
    }
}
