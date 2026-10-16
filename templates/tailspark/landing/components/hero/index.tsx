import BgStar from "../../assets/imgs/bgstar.svg";
import { Hero } from "@/types/landing";

export default ({ hero, count }: { hero: Hero; count?: number }) => {
  return (
    <section className="relatve">
      <div className="mx-auto w-full max-w-7xl px-4 mt-12 md:mt-24">
        <div className="mx-auto w-full max-w-4xl text-center">
          <h1 className="text-primary leading-tight text-5xl font-bold md:text-6xl">
            {hero.title}
          </h1>
          <h2 className="mt-4 mb-4 md:mt-8 md:mb-4 text-2xl md:text-3xl text-center">
            <span className="text-primary font-bold">{count}</span>{" "}
            {hero.description}
          </h2>
        </div>
      </div>
      <img
        src={BgStar.src}
        alt=""
        className="absolute bottom-[auto] left-[auto] right-0 top-24 -z-10 inline-block max-[767px]:hidden"
      />
      <img
        src={BgStar.src}
        alt="bgstar"
        className="absolute bottom-[auto] right-[auto] left-0 top-60 -z-10 inline-block max-[767px]:hidden"
      />
    </section>
  );
};
