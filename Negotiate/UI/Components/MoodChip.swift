import SwiftUI

struct MoodChip: View {
    let mood: SellerMood

    var body: some View {
        Text(mood.rawValue)
            .font(.caption.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .foregroundStyle(.white)
            .background(backgroundColor)
            .clipShape(Capsule())
    }

    private var backgroundColor: Color {
        switch mood.sentiment {
        case .positive:
            return DesignSystem.Colors.primary.opacity(0.75)
        case .neutral:
            return DesignSystem.Colors.warning.opacity(0.75)
        case .negative:
            return DesignSystem.Colors.danger.opacity(0.75)
        }
    }
}
