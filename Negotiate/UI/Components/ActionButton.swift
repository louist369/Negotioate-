import SwiftUI

struct ActionButton: View {
    let title: String
    let icon: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                Text(title)
                    .font(.footnote.bold())
            }
            .foregroundStyle(DesignSystem.Colors.bodyText)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(tint.opacity(0.18))
            .clipShape(RoundedRectangle(cornerRadius: DesignSystem.Radius.control))
        }
        .buttonStyle(.plain)
    }
}
