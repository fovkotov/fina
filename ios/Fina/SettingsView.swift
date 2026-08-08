import SwiftUI

struct SettingsView: View {
    @Environment(AppStore.self) private var store
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ZStack {
                FinaTheme.background
                Form {
                    Section("Ты") {
                        LabeledContent("Имя", value: store.member?.name ?? "—")
                        LabeledContent("Счёт", value: store.summary?.name ?? "ФИНА")
                    }

                    Section("Поделиться") {
                        if let share = store.shareInfo {
                            LabeledContent("Код", value: share.inviteCode)
                            Text(share.hint)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            ShareLink(
                                item: """
                                Привет! Зайди в ФИНА.
                                Код: \(share.inviteCode)
                                PIN: 1425
                                Веб: \(share.webUrl)
                                Выбери своё имя: Аня или Андрей.
                                """
                            ) {
                                Label("Отправить приглашение", systemImage: "square.and.arrow.up")
                            }
                            Button {
                                UIPasteboard.general.string = share.webUrl
                                copied = true
                            } label: {
                                Label(
                                    copied ? "Ссылка скопирована" : "Скопировать веб-ссылку",
                                    systemImage: "link"
                                )
                            }
                        } else {
                            Text("Обновляю…")
                        }
                    }

                    Section("Быстрый доступ") {
                        Text("Spotlight / Поиск: «Внести в ФИНА», «Списать в ФИНА».")
                            .font(.footnote)
                        Text("Home Screen: долгий тап по иконке → Внесение / Списание.")
                            .font(.footnote)
                        Text("Control Center: Добавить элемент «ФИНА · Внесение/Списание».")
                            .font(.footnote)
                        Text("Двойной клик кнопки питания зарезервирован Apple Pay — повесь ФИНА на Action Button или Control Center.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Button("Открыть быстрое внесение") {
                            NotificationCenter.default.post(
                                name: .finaQuickAdd,
                                object: nil,
                                userInfo: ["type": "deposit"]
                            )
                        }
                        Button("Открыть быстрое списание") {
                            NotificationCenter.default.post(
                                name: .finaQuickAdd,
                                object: nil,
                                userInfo: ["type": "withdrawal"]
                            )
                        }
                    }

                    Section("Сервер (общая база)") {
                        TextField("API URL", text: Bindable(store).apiBaseURL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .textContentType(.URL)
                        Button("Сохранить и обновить") {
                            Task {
                                await APIClient.shared.setBaseURL(store.apiBaseURL)
                                UserDefaults.standard.set(store.apiBaseURL, forKey: "apiBaseURL")
                                await store.refresh()
                            }
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    Section {
                        Button("Выйти", role: .destructive) {
                            store.logout()
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Ещё")
            .task { await store.refresh() }
        }
    }
}
