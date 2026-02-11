import SwiftUI

struct GameCard: View {
    let title: String
    let subtitle: String
    let icon: String
    let accent: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: DesignSystem.Radius.control)
                        .fill(accent.opacity(0.18))
                        .frame(width: 42, height: 42)
                    Image(systemName: icon)
                        .font(.headline)
                        .foregroundStyle(accent)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(DesignSystem.Colors.bodyText)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(DesignSystem.Colors.secondaryText)
                }

                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(DesignSystem.Colors.secondaryText)
            }
            .padding(DesignSystem.Spacing.sm)
            .background(DesignSystem.Colors.cardSurface)
            .overlay(
                RoundedRectangle(cornerRadius: DesignSystem.Radius.card)
                    .stroke(DesignSystem.Colors.border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: DesignSystem.Radius.card))
            .shadow(
                color: DesignSystem.Shadow.cardElevation.color,
                radius: DesignSystem.Shadow.cardElevation.radius,
                x: DesignSystem.Shadow.cardElevation.x,
                y: DesignSystem.Shadow.cardElevation.y
            )
        }
        .buttonStyle(.plain)
        .contentShape(RoundedRectangle(cornerRadius: DesignSystem.Radius.card))
    }
}
