(function (global) {
  const MODE_LABELS = {
    single_format: 'Enkeltformat',
    multi_stage: 'Flerdagers',
    ryder_cup: 'Ryder Cup'
  };

  const FORMAT_CONTENT = {
    stableford: {
      key: 'stableford',
      displayName: 'Stableford',
      heroTitle: 'Stableford',
      shortDescription: 'En individuell spillform der poeng deles ut ut fra resultatet på hvert hull.',
      formatLabel: 'Stableford',
      formatType: 'individual',
      teamSize: 1,
      topSummary: 'I Stableford teller poeng per hull, ikke bare totalt antall slag. Det gir en mer offensiv og spillervennlig konkurranseform.',
      howItWorksLabel: 'SLIK SPILLES DET',
      rules: [
        { title: 'Spill egen ball hele hullet', text: 'Hver spiller spiller sin egen ball fra tee til ballen er i hullet.' },
        { title: 'Poeng på hvert hull', text: 'Du får Stableford-poeng ut fra resultatet ditt på hvert hull sammenlignet med hullets par og eventuelt handicap.' },
        { title: 'Dårlige hull ødelegger mindre', text: 'Har du et svakt hull, taper du bare poengene på det hullet. Du kan fortsatt hente deg inn igjen senere.' },
        { title: 'Flest poeng vinner', text: 'Etter fullført runde er det spilleren med høyest totale Stableford-poengsum som vinner.' }
      ],
      scoreMethodTitle: 'Scoring',
      scoreMethodText: 'Hvert hull gir poeng. Total poengsum etter runden avgjør plasseringen.',
      handicapTitle: 'Handicap',
      handicapText: 'Handicap brukes for å beregne netto resultat og riktig poengtildeling dersom turneringen spilles med handicap.',
      specialNotesTitle: 'Viktig å vite',
      specialNotesText: 'Stableford passer godt når man vil holde tempoet oppe og redusere konsekvensen av ett dårlig hull.',
      infoCards: [
        { title: 'Individuell konkurranse', text: 'Alle spiller for seg selv, og hver spillers poeng summeres gjennom hele runden.' },
        { title: 'Poeng fremfor slag', text: 'Denne spillformen belønner gode hull uten at ett svakt hull ødelegger hele dagen.' },
        { title: 'Handicapvennlig', text: 'Stableford fungerer godt både brutto og netto, og gjør det enklere å samle spillere på ulike nivåer.' }
      ]
    },
    slagspill: {
      key: 'slagspill',
      displayName: 'Slagspill',
      heroTitle: 'Slagspill',
      shortDescription: 'Klassisk golf der hvert eneste slag teller fra start til slutt.',
      formatLabel: 'Slagspill',
      formatType: 'individual',
      teamSize: 1,
      topSummary: 'Slagspill er den mest tradisjonelle konkurranseformen i golf. Lavest totale antall slag vinner.',
      howItWorksLabel: 'SLIK SPILLES DET',
      rules: [
        { title: 'Spill egen ball hele veien', text: 'Hver spiller spiller sin egen ball fra utslag til ballen er i hullet på hvert eneste hull.' },
        { title: 'Alle slag teller', text: 'Hvert slag registreres. Det finnes ingen poeng per hull slik som i Stableford.' },
        { title: 'Fullfør alle hull', text: 'For å få en gyldig totalscore må runden fullføres i henhold til turneringsoppsettet.' },
        { title: 'Lavest score vinner', text: 'Etter endt runde er det spilleren med færrest totale slag som vinner turneringen.' }
      ],
      scoreMethodTitle: 'Scoring',
      scoreMethodText: 'Totalsummen av alle slag gjennom runden avgjør resultatet.',
      handicapTitle: 'Handicap',
      handicapText: 'Hvis turneringen bruker handicap, trekkes spillerens tildelte slag fra bruttoscoren for å finne netto resultat.',
      specialNotesTitle: 'Viktig å vite',
      specialNotesText: 'Slagspill stiller høye krav til konsentrasjon, fordi hvert eneste slag påvirker sluttresultatet.',
      infoCards: [
        { title: 'Klassisk format', text: 'Dette er den tradisjonelle konkurranseformen de fleste forbinder med golf.' },
        { title: 'Hvert slag teller', text: 'Det finnes ingen hull-poeng eller dueller — totalsummen gjennom runden avgjør.' },
        { title: 'Passer enkeltturneringer', text: 'Slagspill egner seg godt når man vil kåre den objektivt beste totalscoren.' }
      ]
    },
    '2-manns scramble': {
      key: '2-manns scramble',
      displayName: '2-manns Scramble',
      heroTitle: '2-Manns Scramble',
      shortDescription: 'Et lagformat der to spillere samarbeider om best mulig score på hvert hull.',
      formatLabel: '2-Manns Scramble',
      formatType: 'team',
      teamSize: 2,
      topSummary: 'Begge spillerne bidrar på hvert hull. Laget velger den beste ballen og spiller videre derfra.',
      howItWorksLabel: 'SLIK SPILLES DET',
      rules: [
        { title: 'Begge slår ut', text: 'Begge spillerne på laget slår hvert sitt utslag på hvert hull.' },
        { title: 'Velg beste ball', text: 'Laget velger den beste av de to ballene og markerer stedet.' },
        { title: 'Begge spiller videre derfra', text: 'Begge slår neste slag fra valgt posisjon. Dette gjentas til ballen er i hullet.' },
        { title: 'Én lagscore registreres', text: 'Når hullet er ferdig, registreres lagets samlede score for hullet.' }
      ],
      scoreMethodTitle: 'Scoring',
      scoreMethodText: 'Laget fører én score per hull. Det er lagets beste samarbeid som avgjør totalscoren.',
      handicapTitle: 'Handicap',
      handicapText: 'Hvis handicap brukes, beregnes lagets turneringshandicap ut fra turneringsoppsettet og handicapprosenten som er satt av admin.',
      specialNotesTitle: 'Viktig å vite',
      specialNotesText: '2-manns scramble gir høy fart, mange birdiesjanser og passer godt til sosiale, konkurransepregede turneringer.',
      infoCards: [
        { title: 'To spillere per lag', text: 'Begge er involvert i hvert hull, og lagets valg avgjør den videre strategien.' },
        { title: 'Lagspill og taktikk', text: 'Formatet belønner samarbeid, trygge valg og evnen til å utnytte en god ball.' },
        { title: 'Én score per hull', text: 'Det er lagets hullscore som føres, ikke individuelle resultater.' }
      ]
    },
    'texas scramble (4-manns)': {
      key: 'texas scramble (4-manns)',
      displayName: 'Texas Scramble (4-manns)',
      heroTitle: 'Texas Scramble',
      shortDescription: 'Et lagformat der fire spillere samarbeider om én felles score på hvert hull.',
      formatLabel: 'Texas Scramble (4-manns)',
      formatType: 'team',
      teamSize: 4,
      topSummary: 'Alle fire spillerne deltar på hvert hull, og laget velger den beste ballen før alle spiller videre fra samme sted.',
      howItWorksLabel: 'SLIK SPILLES DET',
      rules: [
        { title: 'Alle fire slår ut', text: 'Alle fire spillerne på laget slår hvert sitt utslag på hvert hull.' },
        { title: 'Laget velger beste ball', text: 'Etter utslag og hvert påfølgende slag velger laget den beste ballplasseringen.' },
        { title: 'Alle spiller fra samme sted', text: 'Alle fire spiller neste slag fra valgt posisjon. Dette gjentas helt til hullet er fullført.' },
        { title: 'Lagets score registreres', text: 'Kun én score føres per hull — lagets resultat etter at ballen er i hullet.' }
      ],
      scoreMethodTitle: 'Scoring',
      scoreMethodText: 'Én lagscore per hull registreres. Lavest totale lagscore vinner dersom turneringen spilles som slagkonkurranse.',
      handicapTitle: 'Handicap',
      handicapText: 'Eventuell handicapberegning styres av turneringsoppsettet. Dersom handicap brukes, skal infosiden vise den prosenten eller modellen admin har valgt.',
      specialNotesTitle: 'Viktig å vite',
      specialNotesText: 'Texas Scramble belønner samarbeid, bredde i laget og gode taktiske beslutninger gjennom hele runden.',
      infoCards: [
        { title: 'Fire spillere per lag', text: 'Alle fire bidrar, og laget får mange muligheter til å velge en sterk ball.' },
        { title: 'Samarbeid hele veien', text: 'Fra tee til green handler det om å maksimere lagets beste mulighet i hvert slag.' },
        { title: 'Perfekt for event', text: 'Texas Scramble er en svært sosial og publikumsvennlig spillform som passer godt til større turneringer.' }
      ]
    },
    greensome: {
      key: 'greensome',
      displayName: 'Greensome',
      heroTitle: 'Greensome',
      shortDescription: 'Et tomannsformat der begge slår ut, og laget velger én ball å spille videre med.',
      formatLabel: 'Greensome',
      formatType: 'team',
      teamSize: 2,
      topSummary: 'Greensome kombinerer valgfrihet fra tee med tradisjonelt makkerspill videre på hullet.',
      howItWorksLabel: 'SLIK SPILLES DET',
      rules: [
        { title: 'Begge slår ut', text: 'Begge spillerne på laget slår hvert sitt utslag på hvert hull.' },
        { title: 'Velg beste utslag', text: 'Laget velger hvilken av de to utslagsballene de vil spille videre med.' },
        { title: 'Annenhver slag videre', text: 'Etter valgt utslag spiller laget videre på samme ball annenhver gang til hullet er ferdig.' },
        { title: 'Én score per lag', text: 'Lagets totale antall slag på hullet registreres som hullscore.' }
      ],
      scoreMethodTitle: 'Scoring',
      scoreMethodText: 'Laget spiller én ball etter valgt utslag, og total lagscore per hull registreres.',
      handicapTitle: 'Handicap',
      handicapText: 'Handicap kan brukes etter klubbens eller turneringens fastsatte modell for greensome.',
      specialNotesTitle: 'Viktig å vite',
      specialNotesText: 'Greensome er et strategisk format der et godt utslagvalg kan få stor betydning for resten av hullet.',
      infoCards: [
        { title: 'To utslag, én ball videre', text: 'Laget får to sjanser fra tee, men må deretter spille videre på én valgt ball.' },
        { title: 'Annenhver slag', text: 'Formatet krever rytme, samarbeid og god planlegging mellom spillerne.' },
        { title: 'Taktisk spillform', text: 'Greensome belønner lag som velger klokt og spiller stabilt underveis.' }
      ]
    },
    foursome: {
      key: 'foursome',
      displayName: 'Foursome',
      heroTitle: 'Foursome',
      shortDescription: 'Et klassisk tomannsformat der laget spiller én ball og slår annenhver gang.',
      formatLabel: 'Foursome',
      formatType: 'team',
      teamSize: 2,
      topSummary: 'I foursome deles alt ansvar mellom to spillere som sammen må håndtere én ball gjennom hele hullet.',
      howItWorksLabel: 'SLIK SPILLES DET',
      rules: [
        { title: 'Én ball per lag', text: 'Laget spiller kun én ball gjennom hele hullet.' },
        { title: 'Annenhver spiller slår', text: 'Spillerne på laget slår annenhver gang til ballen er i hullet.' },
        { title: 'Fast rekkefølge', text: 'Spillernes slagrekkefølge følger formatets regler og byttes ikke fritt underveis.' },
        { title: 'Lagets score teller', text: 'Det totale antall slag laget bruker på hullet registreres som hullscore.' }
      ],
      scoreMethodTitle: 'Scoring',
      scoreMethodText: 'Laget fører én hullscore basert på hvor mange slag som brukes med den ene ballen.',
      handicapTitle: 'Handicap',
      handicapText: 'Handicap kan brukes dersom turneringen er satt opp med en handicapmodell for foursome.',
      specialNotesTitle: 'Viktig å vite',
      specialNotesText: 'Foursome stiller store krav til samspill, trygghet og mental robusthet fordi hvert slag påvirker makkeren direkte.',
      infoCards: [
        { title: 'Én ball hele veien', text: 'I motsetning til scramble finnes det ingen valgmuligheter underveis — laget må leve med hvert slag.' },
        { title: 'Annenhver slag', text: 'Begge spillere må være synkroniserte og komfortable med rollene sine.' },
        { title: 'Tradisjonell laggolf', text: 'Foursome er en klassisk konkurranseform i både klubbturneringer og lagmatcher.' }
      ]
    },
    'bestball / four-ball': {
      key: 'bestball / four-ball',
      displayName: 'Bestball / Four-ball',
      heroTitle: 'Bestball / Four-ball',
      shortDescription: 'Et lagformat der hver spiller spiller sin egen ball, men lagets beste score på hullet teller.',
      formatLabel: 'Bestball / Four-ball',
      formatType: 'team',
      teamSize: 2,
      topSummary: 'Begge spillerne spiller individuelt på hvert hull, men laget får uttelling for den beste scoren.',
      howItWorksLabel: 'SLIK SPILLES DET',
      rules: [
        { title: 'Begge spiller egen ball', text: 'Begge spillerne spiller hver sin ball fra tee til ballen er i hullet.' },
        { title: 'Beste score teller', text: 'Når hullet er ferdig, er det den laveste av de to individuelle scorene som blir lagets hullscore.' },
        { title: 'Begge kan bidra', text: 'Én spiller kan redde laget på ett hull, mens makkeren kan være avgjørende på neste.' },
        { title: 'Stabilitet over tid', text: 'Formatet belønner lag som klarer å levere minst én god score på hvert hull.' }
      ],
      scoreMethodTitle: 'Scoring',
      scoreMethodText: 'Lagets score på hvert hull er den beste individuelle scoren blant de to spillerne.',
      handicapTitle: 'Handicap',
      handicapText: 'Ved bruk av handicap beregnes resultatene etter reglene satt for bestball / four-ball i turneringen.',
      specialNotesTitle: 'Viktig å vite',
      specialNotesText: 'Dette er et tilgjengelig og populært lagformat fordi begge spillerne får spille sin egen ball hele veien.',
      infoCards: [
        { title: 'Egen ball hele hullet', text: 'Begge spiller fullt ut, og laget får uttelling for den sterkeste prestasjonen på hvert hull.' },
        { title: 'Laveste score teller', text: 'Formatet skaper mange birdie-sjanser uten at begge må levere samtidig.' },
        { title: 'God lagdynamikk', text: 'Bestball passer godt når man vil kombinere individuell følelse med lagkonkurranse.' }
      ]
    },
    matchspill: {
      key: 'matchspill',
      displayName: 'Matchspill',
      heroTitle: 'Matchspill',
      shortDescription: 'En duellspillform der hvert hull vinnes, deles eller tapes separat.',
      formatLabel: 'Matchspill',
      formatType: 'individual',
      teamSize: 1,
      topSummary: 'I matchspill er det hullseire som teller, ikke total score på hele runden.',
      howItWorksLabel: 'SLIK SPILLES DET',
      rules: [
        { title: 'Hvert hull er en egen kamp', text: 'På hvert hull sammenlignes spillerens score direkte mot motstanderen.' },
        { title: 'Vinn, del eller tap hullet', text: 'Lavest score på hullet vinner hullet. Lik score betyr delt hull.' },
        { title: 'Matchstatus oppdateres fortløpende', text: 'Stillingen uttrykkes i antall hull opp eller ned gjennom runden.' },
        { title: 'Matchen kan avgjøres før runden er ferdig', text: 'Hvis en spiller leder med flere hull enn det gjenstår å spille, er matchen avgjort.' }
      ],
      scoreMethodTitle: 'Scoring',
      scoreMethodText: 'Det er antall vunne hull som avgjør matchen, ikke total antall slag.',
      handicapTitle: 'Handicap',
      handicapText: 'Dersom matchen spilles med handicap, brukes tildelte slag etter oppsettet i turneringen.',
      specialNotesTitle: 'Viktig å vite',
      specialNotesText: 'Matchspill er mer direkte og psykologisk enn slagspill, fordi hvert hull er sin egen konkurranse.',
      infoCards: [
        { title: 'Hull for hull-duell', text: 'Et dårlig hull kan glemmes med en gang — neste hull er en ny mulighet.' },
        { title: 'Taktikk mot motstander', text: 'Spillere kan velge mer aggressive eller konservative linjer ut fra matchsituasjonen.' },
        { title: 'Rask og intens konkurranse', text: 'Matchspill skaper mye nerve fordi stillingen kan svinge raskt.' }
      ]
    }
  };

  const FALLBACK_CONTENT = {
    key: 'unknown',
    displayName: 'Ukjent spillform',
    heroTitle: 'Turneringsinformasjon',
    shortDescription: 'Informasjon om spillform og regler blir oppdatert når turneringsformat er satt.',
    formatLabel: 'Ukjent spillform',
    formatType: 'individual',
    teamSize: 1,
    topSummary: 'Informasjon om spillform og regler blir oppdatert når turneringsformat er satt.',
    howItWorksLabel: 'SLIK SPILLES DET',
    rules: [],
    scoreMethodTitle: 'Scoring',
    scoreMethodText: 'Detaljer publiseres når turneringsformat er satt.',
    handicapTitle: 'Handicap',
    handicapText: 'Handicapoppsett vises når turneringsformat er konfigurert.',
    specialNotesTitle: 'Viktig å vite',
    specialNotesText: 'Sjekk tilbake senere for oppdatert turneringsinformasjon.',
    infoCards: []
  };

  function normalizeTournamentFormat(format) {
    const raw = String(format || '').trim().toLowerCase();
    if (!raw) return '';
    if (FORMAT_CONTENT[raw]) return raw;

    const aliases = {
      stableford: 'stableford',
      slagspill: 'slagspill',
      strokeplay: 'slagspill',
      '2-manns scramble': '2-manns scramble',
      '2-mann scramble': '2-manns scramble',
      '2 manns scramble': '2-manns scramble',
      texas_scramble: '2-manns scramble',
      scramble2: '2-manns scramble',
      'texas scramble (4-manns)': 'texas scramble (4-manns)',
      'texas scramble': 'texas scramble (4-manns)',
      texas_scramble_4: 'texas scramble (4-manns)',
      scramble4: 'texas scramble (4-manns)',
      greensome: 'greensome',
      foursome: 'foursome',
      'bestball / four-ball': 'bestball / four-ball',
      'four-ball': 'bestball / four-ball',
      fourball: 'bestball / four-ball',
      bestball: 'bestball / four-ball',
      matchspill: 'matchspill',
      matchplay: 'matchspill'
    };

    return aliases[raw] || '';
  }

  function getFormatContent(format) {
    const key = normalizeTournamentFormat(format);
    return FORMAT_CONTENT[key] || FALLBACK_CONTENT;
  }

  function getModeLabel(mode) {
    return MODE_LABELS[String(mode || '').trim().toLowerCase()] || null;
  }

  global.TournamentFormatContent = {
    FORMAT_CONTENT,
    FALLBACK_CONTENT,
    MODE_LABELS,
    normalizeTournamentFormat,
    getFormatContent,
    getModeLabel
  };
})(window);
