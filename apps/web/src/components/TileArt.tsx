import { Carrot } from "./Carrot";
import { CarrotBox } from "./CarrotBox";
import { PlayingCard } from "./PlayingCard";
import { Chip, ChipStack } from "./Chip";
import { RouletteWheel } from "./RouletteWheel";
import { Die } from "./Die";
import { DiceCup } from "./DiceCup";

export function TileArt({ game }: { game: string }) {
  switch (game) {
    case "carrot": return (
      <div className="art art-carrot"><CarrotBox width={150} label="Box" /><div className="art-carrot-c"><Carrot width={84} /></div><div className="art-chip"><ChipStack values={[0.05, 0.05, 0.01]} size={40} /></div></div>);
    case "holdem": return (
      <div className="art art-holdem"><PlayingCard code="AS" width={78} className="fan-l" /><PlayingCard code="KS" width={78} className="fan-r" /><PlayingCard code="AS" faceUp={false} width={78} className="fan-b" /><div className="art-chip"><ChipStack values={[0.1, 0.1, 0.05, 0.01]} size={40} /></div></div>);
    case "liars": return (
      <div className="art art-liars"><DiceCup width={96} /><div className="dice-row"><Die value={5} size={42} /><Die value={5} size={42} /><Die value={2} size={42} /></div></div>);
    case "roulette": return (<div className="art art-roulette"><RouletteWheel size={230} showBall={false} /></div>);
    case "blackjack": return (
      <div className="art art-bj"><PlayingCard code="AH" width={80} className="bj1" /><PlayingCard code="KC" width={80} className="bj2" /><div className="art-chip"><ChipStack values={[0.5, 0.1, 0.1]} size={42} /></div><span className="bj-21">BLACKJACK PAYS 3 TO 2</span></div>);
    case "dice": return (<div className="art art-dice"><Die value={6} size={70} color="ruby" /><Die value={4} size={70} color="ruby" /><Chip value={0.01} size={46} /></div>);
    case "crash": return (
      <div className="art art-crash">
        <svg viewBox="0 0 300 160" width="100%" height="100%" aria-label="Crash multiplier curve">
          <defs><linearGradient id="cr-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F4B728" stopOpacity=".45" /><stop offset="1" stopColor="#F4B728" stopOpacity="0" /></linearGradient></defs>
          {[40, 80, 120].map(y => <line key={y} x1="20" x2="290" y1={y} y2={y} stroke="#F3ECDD" strokeOpacity=".08" />)}
          <path d="M20 150C110 148 190 120 270 30V150z" fill="url(#cr-fill)" />
          <path d="M20 150C110 148 190 120 270 30" fill="none" stroke="#F4B728" strokeWidth="3" />
          <circle cx="270" cy="30" r="6" fill="#FFE7A3" />
          <text x="150" y="80" textAnchor="middle" fontFamily="var(--font-display)" fontSize="46" fontWeight="700" fill="#F3ECDD">2.48×</text>
        </svg>
      </div>);
  }
  return null;
}
