import SwiftUI

struct QuickAddSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State var type: TransactionType
    @State private var amountText = ""
    @State private var note = ""
    @FocusState private var amountFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Тип", selection: $type) {
                        Text("Внесение").tag(TransactionType.deposit)
                        Text("Списание").tag(TransactionType.withdrawal)
                    }
                    .pickerStyle(.segmented)
                }

                Section("Сумма") {
                    TextField("0,00", text: $amountText)
                        .keyboardType(.decimalPad)
                        .font(.system(size: 40, weight: .bold, design: .rounded))
                        .focused($amountFocused)
                }

                Section("Комментарий") {
                    TextField("Необязательно", text: $note)
                }

                if let error = store.errorMessage {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(type == .deposit ? "Внесение" : "Списание")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить", systemImage: "checkmark") {
                        Task { await save() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(store.isLoading)
                }
            }
            .onAppear { amountFocused = true }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }

    private func save() async {
        let normalized = amountText
            .replacingOccurrences(of: ",", with: ".")
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "\u{00a0}", with: "")
        guard let amount = Double(normalized), amount > 0 else {
            store.errorMessage = "Введи сумму"
            return
        }
        let ok = await store.addTransaction(
            type: type,
            amount: amount,
            note: note,
            memberId: store.member?.id,
            date: Date()
        )
        if ok { dismiss() }
    }
}
