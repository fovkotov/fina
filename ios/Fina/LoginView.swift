import SwiftUI

struct LoginView: View {
    @Environment(AppStore.self) private var store
    @State private var inviteCode = "FINA26"
    @State private var pin = "1425"
    @State private var selectedName = "Андрей"
    @State private var appear = false

    private let names = ["Аня", "Андрей"]

    var body: some View {
        ZStack {
            FinaTheme.background

            VStack(spacing: 28) {
                Spacer(minLength: 40)

                VStack(spacing: 10) {
                    Text("ФИНА")
                        .font(.largeTitle.bold())
                        .fontDesign(.rounded)
                        .foregroundStyle(FinaTheme.ink)
                        .scaleEffect(appear ? 1 : 0.92)
                        .opacity(appear ? 1 : 0)

                    Text("Совместный счёт")
                        .font(.title3.weight(.medium))
                        .fontDesign(.rounded)
                        .foregroundStyle(.secondary)
                        .opacity(appear ? 1 : 0)
                }

                Form {
                    Section("Кто ты?") {
                        Picker("Имя", selection: $selectedName) {
                            ForEach(names, id: \.self) { name in
                                Text(name).tag(name)
                            }
                        }
                        .pickerStyle(.segmented)
                    }

                    Section("Доступ") {
                        TextField("Код приглашения", text: $inviteCode)
                            .textInputAutocapitalization(.characters)
                            .textContentType(.username)
                        SecureField("PIN", text: $pin)
                            .textContentType(.password)
                            .keyboardType(.numberPad)
                    }

                    if let error = store.errorMessage {
                        Section {
                            Text(error).foregroundStyle(.red).font(.footnote)
                        }
                    }

                    Section {
                        Button {
                            Task {
                                await store.login(
                                    inviteCode: inviteCode,
                                    pin: pin,
                                    memberName: selectedName
                                )
                            }
                        } label: {
                            if store.isLoading {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                            } else {
                                Text("Войти")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .tint(FinaTheme.forest)
                        .disabled(store.isLoading)
                        .listRowBackground(Color.clear)
                    }
                }
                .scrollContentBackground(.hidden)
                .finaGlass(cornerRadius: 28)
                .padding(.horizontal, 16)
                .offset(y: appear ? 0 : 24)
                .opacity(appear ? 1 : 0)

                Spacer()
            }
        }
        .onAppear {
            withAnimation(.spring(duration: 0.7)) { appear = true }
        }
    }
}
