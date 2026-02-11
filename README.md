# Negotiate (iOS 17+, SwiftUI)

`Negotiate` is an offline negotiation simulator with a domain-agnostic engine and a V1 `UKHousingPack`.

## Core Features
- Offline-first simulation (no network, no external APIs)
- Deterministic seeded RNG (`SplitMix64`) for reproducibility
- Domain-agnostic engine with pluggable `DomainPack`
- UK housing V1 experience: price + term trades, ask/hold/walk-away, stochastic event cards, delayed callbacks, debrief coaching, NCI progression
- Local JSON persistence in `Application Support`

## Architecture Diagram
```text
NegotiateApp
  -> AppStore (flow + orchestration)
      -> Storage (JSON persistence)
      -> ScenarioGenerator (domain hook)
      -> NegotiationEngine (state machine + utility policy)
          -> BeliefModel (player estimates)
          -> EventDeck (weighted stochastic shocks)
          -> ScoringEngine (debrief + NCI)
      -> SwiftUI Views
          Home -> ScenarioBrief -> Negotiation -> Debrief
          + History + Settings sheets
```

## Module Layout
- `Negotiate/Models`
  - `Scenario`, `HiddenState`, `Archetype`, `Event`, `Terms`, `Action`, `Outcome`, `Debrief`, `DomainPack`
- `Negotiate/Engine`
  - `NegotiationEngine`, `BeliefModel`, `ScenarioGenerator`, `EventDeck`, `ScoringEngine`
- `Negotiate/Persistence`
  - `Storage`
- `Negotiate/Utilities`
  - `DesignSystem`, `SeededRNG`, `HapticsManager`
- `Negotiate/UI`
  - Home/brief/negotiation/feed/meters/intel/debrief/history/settings/sheets/components

## Reproducibility with Seeded RNG
`SeededRNG` uses `SplitMix64`. Given the same seed and action sequence:
- Scenario generation emits the same scenarios
- Engine stochastic branches (noise/events/callback rolls) are deterministic
- Unit tests can lock behavior against expected outcomes

## First-Launch Scenario Strategy
On first launch:
1. Generate first 50 scenarios immediately for quick start.
2. Persist that first batch.
3. Generate full 1000 in background and replace/persist once complete.
4. On decode corruption, scenario file is deleted and regenerated with a user-facing reset alert.

## How to Add a New DomainPack
1. Create a new pack conforming to `DomainPack`.
2. Provide variable labels, terms schema, scenario generator hook, event deck hook, and coaching templates.
3. Implement a generator conforming to `ScenarioGeneratorProtocol`.
4. Optionally implement a custom `EventDeckProtocol` type.
5. Switch pack in `AppStore` initializer.

Skeleton:
```swift
struct SalaryPack: DomainPack {
    let id = "salary_pack"
    let name = "Salary Raise"
    let description = "Manager-employee compensation negotiations"
    let variableLabels: [String: String] = [:]
    let termsSchema: [String] = ["bonus", "title", "startDate"]

    func makeScenarioGenerator(seed: UInt64) -> any ScenarioGeneratorProtocol {
        SalaryScenarioGenerator(seed: seed)
    }

    func makeEventDeck(for scenario: Scenario, seed: UInt64) -> any EventDeckProtocol {
        SalaryEventDeck(seed: seed)
    }

    func coachingTemplates(for outcome: NegotiationOutcome) -> DebriefTemplateSet {
        DebriefTemplateSet(whatWorkedTemplates: [], whatCostTemplates: [])
    }
}
```

## Build Instructions
- Xcode: 15.4+ (recommended latest Xcode 16.x)
- Target: iOS 17.0+
- Device: iPhone-only, portrait

Steps:
1. Open `Negotiate.xcodeproj`.
2. Select `Negotiate` scheme and an iPhone simulator (e.g., iPhone 15).
3. Build and run.
4. Run tests via Product -> Test.
