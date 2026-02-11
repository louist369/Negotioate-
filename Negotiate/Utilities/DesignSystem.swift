import SwiftUI

struct DesignSystem {
    struct Colors {
        static let background = Color(hex: 0x121212)
        static let cardSurface = Color(hex: 0x1E1E1E)
        static let border = Color(hex: 0x2A2A2A)
        static let primary = Color(hex: 0x00E676)
        static let secondary = Color(hex: 0xFFD600)
        static let danger = Color(hex: 0xFF5252)
        static let warning = Color(hex: 0xFFA726)
        static let bodyText = Color.white.opacity(0.87)
        static let secondaryText = Color.white.opacity(0.60)
        static let dimOverlay = Color.black.opacity(0.4)
    }

    struct Spacing {
        static let xs: CGFloat = 8
        static let sm: CGFloat = 16
        static let md: CGFloat = 24
        static let lg: CGFloat = 32
    }

    struct Radius {
        static let card: CGFloat = 12
        static let control: CGFloat = 8
    }

    struct Sizes {
        static let actionBarHeight: CGFloat = 56
    }

    struct Fonts {
        static let heading = Font.title3.bold()
        static let subheading = Font.headline
        static let body = Font.body
        static let caption = Font.caption
    }

    struct Shadow {
        static let cardElevation = (
            color: Color.black.opacity(0.3),
            radius: CGFloat(8),
            x: CGFloat(0),
            y: CGFloat(4)
        )

        static func glowPulse(for color: Color) -> (color: Color, radius: CGFloat, x: CGFloat, y: CGFloat) {
            (color: color.opacity(0.30), radius: 8, x: 0, y: 0)
        }
    }

    struct Animation {
        static let springDefault = SwiftUI.Animation.spring(response: 0.4, dampingFraction: 0.75)
        static let meterChange = SwiftUI.Animation.spring(response: 0.4, dampingFraction: 0.8)
        static let revealSequence = SwiftUI.Animation.easeOut(duration: 1.2)
    }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: alpha
        )
    }

    static let dimOverlay = Color.black.opacity(0.4)
}
