import SwiftUI

struct TransactionsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        NavigationStack {
            ZStack {
                FinaTheme.background
                List {
                    ForEach(store.transactions) { tx in
                        TransactionRow(tx: tx)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .padding(.vertical, 4)
                    }
                    .onDelete { indexSet in
                        for index in indexSet {
                            let id = store.transactions[index].id
                            Task { await store.deleteTransaction(id) }
                        }
                    }
                }
                .scrollContentBackground(.hidden)
                .listStyle(.plain)
            }
            .navigationTitle("Операции")
            .refreshable { await store.refresh() }
        }
    }
}
