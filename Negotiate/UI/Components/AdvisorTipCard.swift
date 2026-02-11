import SwiftUI

struct AdvisorTipCard: View {
    let text: String
    let isPositive: Bool

    private var borderColor: Color {
        isPositive ? DesignSystem.Colors.primary : DesignSystem.Colors.danger
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Rectangle()
                .fill(borderColor)
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "book.fill")
                        .foregroundStyle(borderColor)
                    Text("Advisor")
                        .font(.caption.bold())
                        .foregroundStyle(DesignSystem.Colors.secondaryText)
                }

                Text(text)
                    .font(.footnote)
                    .foregroundStyle(DesignSystem.Colors.bodyText)
            }
            .padding(12)
        }
        .background(DesignSystem.Colors.cardSurface)
        .overlay(
            RoundedRectangle(cornerRadius: DesignSystem.Radius.card)
                .stroke(DesignSystem.Colors.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: DesignSystem.Radius.card))
    }
}
