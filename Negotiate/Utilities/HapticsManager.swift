import UIKit

enum HapticEvent {
    case counterofferReceived
    case offerRejected
    case sellerWithdraws
    case dealAccepted
    case eventCardAppears
    case walkAwayTriggered
    case callbackReceived
}

final class HapticsManager {
    static let shared = HapticsManager()

    private init() {}

    func trigger(_ event: HapticEvent) {
        switch event {
        case .counterofferReceived:
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case .offerRejected:
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        case .sellerWithdraws:
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        case .dealAccepted:
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .eventCardAppears:
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case .walkAwayTriggered:
            UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        case .callbackReceived:
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        }
    }
}
