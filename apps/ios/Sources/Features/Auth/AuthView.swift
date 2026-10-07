import SwiftUI

struct AuthView: View {
    @Environment(AuthSession.self) private var session

    private enum Mode: String, CaseIterable {
        case signIn = "Sign In"
        case signUp = "Sign Up"
    }

    @State private var mode: Mode = .signIn
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""

    private var canSubmit: Bool {
        guard !email.isEmpty, password.count >= 8 else { return false }
        if mode == .signUp && name.trimmingCharacters(in: .whitespaces).isEmpty {
            return false
        }
        return true
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 4) {
                        Image(systemName: "photo.stack.fill")
                            .font(.system(size: 48))
                            .foregroundStyle(.tint)
                        Text("Cameraderie")
                            .font(.largeTitle.bold())
                        Text("Private photo & video sharing")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 32)

                    Picker("Mode", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)

                    VStack(spacing: 12) {
                        if mode == .signUp {
                            TextField("Name", text: $name)
                                .textContentType(.name)
                                .textFieldStyle(.roundedBorder)
                        }
                        TextField("Email", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder)
                        SecureField("Password", text: $password)
                            .textContentType(mode == .signIn ? .password : .newPassword)
                            .textFieldStyle(.roundedBorder)
                    }

                    if let errorMessage = session.errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        if session.isBusy {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text(mode.rawValue)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(!canSubmit || session.isBusy)
                }
                .padding(24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private func submit() async {
        switch mode {
        case .signIn:
            await session.signIn(email: email, password: password)
        case .signUp:
            await session.signUp(name: name, email: email, password: password)
        }
    }
}

#Preview {
    AuthView()
        .environment(AuthSession())
}
