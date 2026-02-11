import SwiftUI

struct NegotiationView: View {
    @ObservedObject var engine: NegotiationEngine
    let onAction: (NegotiationAction) -> Void

    @State private var showingOfferSheet = false
    @State private var showingTradeSheet = false
    @State private var showingAskSheet = false
    @State private var showingIntel = false

    @State private var activeEventOverlay: NegotiationEvent?
    @State private var shownEventIDs: Set<UUID> = []

    @State private var shakingBubbleID: UUID?
    @State private var shakeTrigger: CGFloat = 0

    @State private var acceptedBubbleID: UUID?
    @State private var acceptedScale: CGFloat = 1

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                header

                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 12) {
                            MetersView(meters: engine.meters)

                            if showingIntel {
                                IntelCardView(belief: engine.beliefModel)
                            }

                            feedStack
                        }
                        .padding(DesignSystem.Spacing.sm)
                    }
                    .background(DesignSystem.Colors.background)
                    .onChange(of: engine.feed.count) { _, _ in
                        guard let lastID = engine.feed.last?.id else { return }
                        withAnimation(.easeOut(duration: 0.25)) {
                            proxy.scrollTo(lastID, anchor: .bottom)
                        }
                        handleLatestFeedMutation()
                    }
                    .onAppear {
                        guard let lastID = engine.feed.last?.id else { return }
                        proxy.scrollTo(lastID, anchor: .bottom)
                    }
                }
            }

            if let event = activeEventOverlay {
                EventOverlayCardView(event: event) {
                    withAnimation(DesignSystem.Animation.springDefault) {
                        activeEventOverlay = nil
                    }
                }
                .zIndex(3)
            }
        }
        .background(DesignSystem.Colors.background.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) {
            if activeEventOverlay == nil {
                actionBar
                    .background(DesignSystem.Colors.cardSurface)
                    .overlay(alignment: .top) {
                        Rectangle()
                            .fill(DesignSystem.Colors.border)
                            .frame(height: 1)
                    }
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: activeEventOverlay == nil)
        .sheet(isPresented: $showingOfferSheet) {
            OfferSheet(
                listingPrice: engine.scenario.listingPrice,
                startingPrice: currentPriceAnchor,
                startingTerms: currentTermsAnchor
            ) { price, terms in
                onAction(.offer(price: price, terms: terms, day: engine.day))
            }
        }
        .sheet(isPresented: $showingTradeSheet) {
            TradeSheet(basePrice: currentPriceAnchor, startingTerms: currentTermsAnchor) { delta, terms in
                onAction(.trade(delta: delta, terms: terms, day: engine.day))
            }
        }
        .sheet(isPresented: $showingAskSheet) {
            AskSheet { question in
                onAction(.ask(question, day: engine.day))
            }
        }
        .navigationTitle("Negotiation")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(showingIntel ? "Hide Intel" : "Intel") {
                    withAnimation(DesignSystem.Animation.springDefault) {
                        showingIntel.toggle()
                    }
                }
                .foregroundStyle(DesignSystem.Colors.secondary)
            }
        }
    }

    private var header: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 8) {
                    Text(engine.scenario.addressLabel)
                        .font(.headline)
                        .foregroundStyle(DesignSystem.Colors.bodyText)
                        .lineLimit(2)

                    Spacer()

                    Text(headerStatus.text)
                        .id(headerStatus.text)
                        .font(.caption.bold())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(headerStatus.color.opacity(0.20))
                        .foregroundStyle(headerStatus.color)
                        .clipShape(Capsule())
                        .contentTransition(.opacity)
                        .animation(.easeInOut(duration: 0.25), value: headerStatus.text)
                }

                HStack {
                    Label("£\(engine.scenario.listingPrice)", systemImage: "sterlingsign.circle.fill")
                    Spacer()
                    Label("Day \(engine.day)", systemImage: "calendar")
                }
                .font(.subheadline)
                .foregroundStyle(DesignSystem.Colors.secondaryText)
            }
        }
        .padding([.horizontal, .top], DesignSystem.Spacing.sm)
    }

    private var feedStack: some View {
        VStack(spacing: 10) {
            ForEach(engine.feed) { item in
                switch item.type {
                case .dayLabel:
                    Text(item.text)
                        .font(.caption.bold())
                        .foregroundStyle(DesignSystem.Colors.secondaryText)
                        .frame(maxWidth: .infinity)
                        .id(item.id)

                case .player:
                    HStack {
                        Spacer(minLength: 36)
                        Text(item.text)
                            .font(.footnote)
                            .foregroundStyle(DesignSystem.Colors.bodyText)
                            .padding(10)
                            .background(DesignSystem.Colors.primary.opacity(0.15))
                            .clipShape(RoundedRectangle(cornerRadius: DesignSystem.Radius.card))
                    }
                    .id(item.id)

                case .seller:
                    HStack {
                        VStack(alignment: .leading, spacing: 6) {
                            if let mood = item.mood {
                                MoodChip(mood: mood)
                            }
                            Text(item.text)
                                .font(.footnote)
                                .foregroundStyle(DesignSystem.Colors.bodyText)
                        }
                        .padding(10)
                        .background(DesignSystem.Colors.cardSurface)
                        .overlay(
                            RoundedRectangle(cornerRadius: DesignSystem.Radius.card)
                                .stroke(DesignSystem.Colors.border, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: DesignSystem.Radius.card))
                        .modifier(ShakeEffect(
                            amount: 6,
                            shakesPerUnit: 3,
                            animatableData: shakingBubbleID == item.id ? shakeTrigger : 0
                        ))
                        .scaleEffect(acceptedBubbleID == item.id ? acceptedScale : 1)

                        Spacer(minLength: 30)
                    }
                    .id(item.id)

                case .event:
                    if let event = item.event {
                        EventCardView(event: event)
                            .id(item.id)
                    }
                }
            }
        }
    }

    private var actionBar: some View {
        Group {
            switch engine.phase {
            case .active:
                HStack(spacing: 8) {
                    ActionButton(title: "Offer", icon: "sterlingsign.circle", tint: DesignSystem.Colors.primary) {
                        showingOfferSheet = true
                    }
                    ActionButton(title: "Trade", icon: "arrow.left.arrow.right", tint: DesignSystem.Colors.secondary) {
                        showingTradeSheet = true
                    }
                    ActionButton(title: "Ask", icon: "questionmark.bubble", tint: DesignSystem.Colors.warning) {
                        showingAskSheet = true
                    }
                    ActionButton(title: "Hold", icon: "pause.fill", tint: DesignSystem.Colors.border) {
                        onAction(.hold(day: engine.day))
                    }
                    ActionButton(title: "Walk", icon: "figure.walk", tint: DesignSystem.Colors.danger) {
                        onAction(.walkAway(day: engine.day))
                    }
                }
                .frame(height: DesignSystem.Sizes.actionBarHeight)
                .padding(.horizontal, 8)

            case .walkedAwayPending(let remaining):
                HStack(spacing: 12) {
                    Text("Pending callback (\(remaining)d)")
                        .font(.footnote.bold())
                        .foregroundStyle(DesignSystem.Colors.secondaryText)

                    Button {
                        onAction(.advanceDay(day: engine.day))
                    } label: {
                        Label("Advance Day", systemImage: "clock.fill")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(DesignSystem.Colors.secondary.opacity(0.22))
                            .clipShape(RoundedRectangle(cornerRadius: DesignSystem.Radius.control))
                    }
                    .buttonStyle(.plain)
                }
                .frame(height: DesignSystem.Sizes.actionBarHeight)
                .padding(.horizontal, 12)

            case .resolved:
                HStack {
                    Text("Negotiation resolved. Opening debrief...")
                        .font(.footnote)
                        .foregroundStyle(DesignSystem.Colors.secondaryText)
                }
                .frame(maxWidth: .infinity)
                .frame(height: DesignSystem.Sizes.actionBarHeight)
            }
        }
    }

    private var headerStatus: (text: String, color: Color) {
        switch engine.phase {
        case .walkedAwayPending:
            return ("Walked Away", DesignSystem.Colors.warning)
        case .resolved(let outcome):
            return (outcome.result == .dealReached ? "Resolved: Deal" : "Resolved", outcome.result == .dealReached ? DesignSystem.Colors.primary : DesignSystem.Colors.danger)
        case .active:
            if engine.lastSellerResponse?.type == .callback {
                return ("Callback", DesignSystem.Colors.secondary)
            }
            return ("Active", DesignSystem.Colors.primary)
        }
    }

    private var currentPriceAnchor: Int {
        engine.lastSellerResponse?.counterPrice ?? engine.scenario.listingPrice
    }

    private var currentTermsAnchor: Terms {
        engine.lastSellerResponse?.counterTerms ?? Terms.default
    }

    private func handleLatestFeedMutation() {
        if let eventEntry = engine.feed.last,
           eventEntry.type == .event,
           let event = eventEntry.event,
           !shownEventIDs.contains(event.id) {
            shownEventIDs.insert(event.id)
            withAnimation(DesignSystem.Animation.springDefault) {
                activeEventOverlay = event
            }
        }

        guard let lastSellerBubbleID = engine.feed.last(where: { $0.type == .seller })?.id,
              let response = engine.lastSellerResponse else {
            return
        }

        if response.type == .reject, response.mood == .offended {
            shakingBubbleID = lastSellerBubbleID
            withAnimation(.linear(duration: 0.4)) {
                shakeTrigger += 1
            }
        }

        if response.type == .accept {
            acceptedBubbleID = lastSellerBubbleID
            acceptedScale = 0.95
            withAnimation(DesignSystem.Animation.springDefault) {
                acceptedScale = 1.0
            }
        }
    }
}
