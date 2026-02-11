import SwiftUI

struct CardContainer<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
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
}
