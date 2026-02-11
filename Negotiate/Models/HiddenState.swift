import Foundation

struct HiddenState: Codable, Equatable {
    var reservationValue: Int
    var targetValue: Int
    var flexibility: Double
    var alternativesStrength: Double

    var egoSensitivity: Double
    var patience: Double
    var trust: Double
    var riskTolerance: Double
    var fatigue: Double

    var deadlinePressure: Double
    var infoAsymmetry: Double

    mutating func clamp() {
        flexibility = flexibility.clamped(to: 0...1)
        alternativesStrength = alternativesStrength.clamped(to: 0...1)
        egoSensitivity = egoSensitivity.clamped(to: 0...1)
        patience = patience.clamped(to: 0...1)
        trust = trust.clamped(to: 0...1)
        riskTolerance = riskTolerance.clamped(to: 0...1)
        fatigue = fatigue.clamped(to: 0...1)
        deadlinePressure = deadlinePressure.clamped(to: 0...1)
        infoAsymmetry = infoAsymmetry.clamped(to: 0...1)
        reservationValue = max(0, reservationValue)
        targetValue = max(reservationValue, targetValue)
    }
}
