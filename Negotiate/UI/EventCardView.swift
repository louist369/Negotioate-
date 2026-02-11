import SwiftUI

struct EventCardView: View {
    let event: NegotiationEvent

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Rectangle()
                .fill(DesignSystem.Colors.secondary)
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: event.icon)
                        .foregroundStyle(DesignSystem.Colors.secondary)
                    Text(event.title)
                        .font(.headline)
                        .foregroundStyle(DesignSystem.Colors.bodyText)
                    Spacer()
                }

                Text(event.detail)
                    .font(.subheadline)
                    .foregroundStyle(DesignSystem.Colors.secondaryText)

                if let expires = event.expiresInDays {
                    Text("Offer window: \(expires) day\(expires == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(DesignSystem.Colors.warning)
                }
            }
            .padding(.vertical, 10)
            .padding(.trailing, 10)
        }
        .background(DesignSystem.Colors.cardSurface)
        .overlay(
            RoundedRectangle(cornerRadius: DesignSystem.Radius.card)
                .stroke(DesignSystem.Colors.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: DesignSystem.Radius.card))
    }
}
