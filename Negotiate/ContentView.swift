import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: AppStore

    @State private var showHistory = false
    @State private var showSettings = false
    @Namespace private var scenarioNamespace
    private let scenarioCardID = "scenario-launch-card"

    var body: some View {
        NavigationStack {
            Group {
                if store.isBootstrapping {
                    loadingView
                } else {
                    switch store.flow {
                    case .home:
                        HomeView(
                            nci: store.nci,
                            hasHistory: !store.history.isEmpty,
                            onNewNegotiation: store.startNewNegotiation,
                            onOpenHistory: { showHistory = true },
                            onOpenSettings: { showSettings = true },
                            scenarioNamespace: scenarioNamespace,
                            scenarioCardID: scenarioCardID
                        )

                    case .scenarioBrief:
                        if let scenario = store.selectedScenario {
                            ScenarioBriefView(
                                scenario: scenario,
                                onEnter: store.enterNegotiation,
                                scenarioNamespace: scenarioNamespace,
                                scenarioCardID: scenarioCardID
                            )
                        } else {
                            fallbackView
                        }

                    case .negotiation:
                        if let engine = store.engine {
                            NegotiationView(engine: engine, onAction: store.submitAction)
                        } else {
                            fallbackView
                        }

                    case .debrief:
                        if let report = store.latestDebrief,
                           let engine = store.engine,
                           case .resolved(let outcome) = engine.phase {
                            DebriefView(report: report, outcome: outcome, onDone: store.goHome)
                        } else {
                            fallbackView
                        }
                    }
                }
            }
            .sheet(isPresented: $showHistory) {
                NavigationStack {
                    HistoryView(
                        runs: store.history,
                        scenarioNamespace: scenarioNamespace,
                        scenarioCardID: scenarioCardID
                    )
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView(settings: store.settings, onSave: store.saveSettings)
            }
            .alert(item: $store.alert) { item in
                Alert(title: Text(item.title), message: Text(item.message), dismissButton: .default(Text("OK")))
            }
        }
        .task {
            if store.isBootstrapping {
                await store.bootstrap()
            }
        }
    }

    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(DesignSystem.Colors.primary)
            Text(store.bootstrapMessage)
                .foregroundStyle(DesignSystem.Colors.secondaryText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DesignSystem.Colors.background.ignoresSafeArea())
    }

    private var fallbackView: some View {
        VStack(spacing: 12) {
            Text("State unavailable")
                .foregroundStyle(DesignSystem.Colors.bodyText)
            Button("Back Home") {
                store.goHome()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(DesignSystem.Colors.primary)
            .foregroundStyle(Color.black)
            .clipShape(RoundedRectangle(cornerRadius: DesignSystem.Radius.control))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DesignSystem.Colors.background.ignoresSafeArea())
    }
}
