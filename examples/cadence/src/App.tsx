import CtaBand from './components/CtaBand';
import Features from './components/Features';
import Footer from './components/Footer';
import Header from './components/Header';
import Hero from './components/Hero';
import LogoStrip from './components/LogoStrip';
import Pricing from './components/Pricing';
import Testimonial from './components/Testimonial';

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <LogoStrip />
        <Features />
        <Testimonial />
        <Pricing />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
