import Foundation
import SwiftUI

struct AppAlert: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

enum AppFlowState: Equatable {
    case home
    case scenarioBrief
    case negotiation
    case debrief
}

@MainActor
final class AppStore: ObservableObject {
    @Published var isBootstrapping: Bool = true
    @Published var bootstrapMessage: String = "Preparing simulation..."

    @Published var flow: AppFlowState = .home

    @Published var scenarios: [Scenario] = []
    @Published var history: [RunHistoryItem] = []
    @Published var settings: AppSettings = .default
    @Published var nci: Double = NCISnapshot.default.value

    @Published var selectedScenario: Scenario?
    @Published var engine: NegotiationEngine?
    @Published var latestDebrief: DebriefReport?

    @Published var alert: AppAlert?

    private let storage: Storage
    private let pack: any DomainPack
    private var scenarioCursor: Int = 0

    init(storage: Storage = Storage(), pack: any DomainPack = UKHousingPack()) {
        self.storage = storage
        self.pack = pack
    }

    func bootstrap() async {
        bootstrapMessage = "Loading settings"
        loadSettings()

        bootstrapMessage = "Loading history"
        loadHistory()

        bootstrapMessage = "Loading scenarios"

        do {
            let loaded = try storage.loadScenarios()
            if loaded.isEmpty {
                try await regenerateScenarios(fromCorruption: false)
            } else {
                scenarios = loaded
                isBootstrapping = false
            }
        } catch let decodeError as DecodingError {
            _ = decodeError
            do {
                try storage.resetScenarioData()
            } catch {
                // Best-effort cleanup before regeneration.
            }
            alert = AppAlert(title: "Reset", message: "Data was reset. Generating fresh scenarios.")
            try? await regenerateScenarios(fromCorruption: true)
        } catch {
            try? await regenerateScenarios(fromCorruption: false)
        }
    }

    func startNewNegotiation() {
        guard !scenarios.isEmpty else {
            alert = AppAlert(title: "No scenarios", message: "Scenarios are still generating. Please wait.")
            return
        }

        let index = scenarioCursor % scenarios.count
        scenarioCursor += 1

        let scenario = scenarios[index]
        selectedScenario = scenario
        latestDebrief = nil

        let seed = settings.seed &+ UInt64(index) &+ UInt64(history.count * 17)
        engine = NegotiationEngine(scenario: scenario, pack: pack, seed: seed)
        flow = .scenarioBrief
    }

    func enterNegotiation() {
        flow = .negotiation
    }

    func submitAction(_ action: NegotiationAction) {
        guard let engine else { return }

        let previousFeedCount = engine.feed.count
        engine.submit(action)

        if action.type == .walkAway {
            HapticsManager.shared.trigger(.walkAwayTriggered)
        }

        if engine.feed.count > previousFeedCount,
           let entry = engine.feed.last,
           entry.type == .event {
            HapticsManager.shared.trigger(.eventCardAppears)
        }

        if let response = engine.lastSellerResponse {
            switch response.type {
            case .counter:
                HapticsManager.shared.trigger(.counterofferReceived)
            case .reject:
                HapticsManager.shared.trigger(.offerRejected)
            case .withdraw:
                if case .resolved(let outcome) = engine.phase,
                   outcome.result == .sellerWithdrew {
                    HapticsManager.shared.trigger(.sellerWithdraws)
                }
            case .accept:
                HapticsManager.shared.trigger(.dealAccepted)
            case .callback:
                HapticsManager.shared.trigger(.callbackReceived)
            case .info:
                break
            }
        }

        if case .resolved = engine.phase {
            finalizeRunIfNeeded()
        }
    }

    func goHome() {
        flow = .home
        engine = nil
        selectedScenario = nil
        latestDebrief = nil
    }

    func saveSettings(seedText: String, difficulty: Difficulty, tutorialEnabled: Bool) {
        let parsedSeed = UInt64(seedText) ?? settings.seed
        settings = AppSettings(seed: parsedSeed, difficulty: difficulty, tutorialEnabled: tutorialEnabled)

        do {
            try storage.saveSettings(settings)
        } catch {
            alert = AppAlert(title: "Save failed", message: "Could not save settings.")
        }
    }

    private func loadSettings() {
        do {
            settings = try storage.loadSettings()
        } catch {
            settings = .default
        }
    }

    private func loadHistory() {
        do {
            history = try storage.loadHistory().sorted(by: { $0.endedAt > $1.endedAt })
            nci = history.first?.debrief.resultingNCI ?? NCISnapshot.default.value
        } catch {
            history = []
            nci = NCISnapshot.default.value
        }
    }

    private func finalizeRunIfNeeded() {
        guard let engine, latestDebrief == nil else { return }
        guard let runItem = engine.makeRunHistoryItem(currentNCI: nci) else { return }

        latestDebrief = runItem.debrief
        nci = runItem.debrief.resultingNCI
        history.insert(runItem, at: 0)

        do {
            try storage.saveHistory(history)
        } catch {
            alert = AppAlert(title: "Save failed", message: "Could not save this run. Please try again.")
        }

        flow = .debrief
    }

    private func regenerateScenarios(fromCorruption: Bool) async throws {
        _ = fromCorruption

        bootstrapMessage = "Generating first 50 scenarios"
        var generator = ScenarioGenerator(pack: pack, seed: settings.seed)
        let firstBatch = generator.generate(count: 50)
        scenarios = firstBatch

        do {
            try storage.saveScenarios(firstBatch)
        } catch {
            // Non-fatal interim save failure.
        }

        isBootstrapping = false

        Task.detached(priority: .background) { [settingsSeed = settings.seed, storage] in
            var fullGenerator = ScenarioGenerator(pack: UKHousingPack(), seed: settingsSeed)
            let fullSet = fullGenerator.generate(count: 1000)
            do {
                try storage.saveScenarios(fullSet)
            } catch {
                // Leave first batch available if full persistence fails.
            }

            await MainActor.run {
                self.scenarios = fullSet
            }
        }
    }
}
