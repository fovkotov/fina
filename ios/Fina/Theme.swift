import SwiftUI

enum FinaTheme {
    static let forest = Color(red: 0.18, green: 0.44, blue: 0.37)
    static let clay = Color(red: 0.77, green: 0.36, blue: 0.15)
    static let ink = Color(red: 0.12, green: 0.14, blue: 0.13)
    static let mist = Color(red: 0.93, green: 0.95, blue: 0.93)
    static let sand = Color(red: 0.96, green: 0.94, blue: 0.89)

    static var background: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.90, green: 0.94, blue: 0.91),
                    Color(red: 0.97, green: 0.95, blue: 0.90),
                    Color(red: 0.88, green: 0.91, blue: 0.88),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(forest.opacity(0.18))
                .frame(width: 280, height: 280)
                .blur(radius: 40)
                .offset(x: -120, y: -220)
            Circle()
                .fill(clay.opacity(0.16))
                .frame(width: 260, height: 260)
                .blur(radius: 50)
                .offset(x: 140, y: 280)
        }
        .ignoresSafeArea()
    }
}

extension View {
    @ViewBuilder
    func finaGlass(cornerRadius: CGFloat = 28) -> some View {
        if #available(iOS 26.0, *) {
            self
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: cornerRadius))
        } else {
            self
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
    }
}
