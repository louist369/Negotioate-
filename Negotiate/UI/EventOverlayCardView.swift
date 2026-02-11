import SwiftUI

struct EventOverlayCardView: View {
    let event: NegotiationEvent
    let onContinue: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 48)

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: event.icon)
                        .font(.title3)
                        .foregroundStyle(DesignSystem.Colors.secondary)
                    Text(event.title)
                        .font(.headline)
                        .foregroundStyle(DesignSystem.Colors.bodyText)
                    Spacer()
                }

                Text(event.detail)
                    .font(.subheadline)
                    .foregroundStyle(DesignSystem.Colors.bodyText)

                if let expires = event.expiresInDays {
                    Label("Offer expires in \(expires) day\(expires == 1 ? "" : "s")", systemImage: "clock.fill")
                        .font(.caption)
                        .foregroundStyle(DesignSystem.Colors.warning)
                }

                Button(action: onContinue) {
                    Text("Continue")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(DesignSystem.Colors.secondary)
                        .foregroundStyle(Color.black)
                        .clipShape(RoundedRectangle(cornerRadius: DesignSystem.Radius.control))
                }
                .padding(.top, 4)
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
            .padding(.horizontal, DesignSystem.Spacing.md)
            .transition(.move(edge: .top).combined(with: .opacity))

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.dimOverlay.ignoresSafeArea())
    }
}
