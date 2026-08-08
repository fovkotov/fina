import SwiftUI

struct AddTransactionView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var type: TransactionType = .deposit
    @State private var amountText = ""
    @State private var note = ""
    @State private var memberId: String?
    @State private var date = Date()

    private var needsMember: Bool {
        type == .deposit || type == .withdrawal
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Тип") {
                    Picker("Тип", selection: $type) {
                        ForEach(TransactionType.allCases) { t in
                            Label(t.title, systemImage: t.systemImage).tag(t)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }

                Section("Сумма") {
                    TextField("0,00", text: $amountText)
                        .keyboardType(.decimalPad)
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                }

                if needsMember {
                    Section("Кто") {
                        Picker("Участник", selection: $memberId) {
                            ForEach(store.summary?.members ?? []) { m in
                                Text(m.name).tag(Optional(m.id))
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                }

                Section("Детали") {
                    TextField("Комментарий", text: $note)
                    DatePicker("Дата", selection: $date, displayedComponents: .date)
                }

                if let error = store.errorMessage {
                    Section {
                        Text(error).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Новая операция")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") {
                        Task {
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
                                memberId: needsMember ? memberId : nil,
                                date: date
                            )
                            if ok { dismiss() }
                        }
                    }
                    .disabled(store.isLoading)
                }
            }
            .onAppear {
                memberId = store.member?.id ?? store.summary?.members.first?.id
            }
        }
    }
}
