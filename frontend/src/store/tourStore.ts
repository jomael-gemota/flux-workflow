import { create } from 'zustand';

export const TOUR_DONE_KEY = 'flux_tour_done';
const TOTAL_STEPS = 6;

interface TourStore {
  active: boolean;
  step: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  end: () => void;
}

export const useTourStore = create<TourStore>((set, get) => ({
  active: false,
  step: 0,

  start() {
    set({ active: true, step: 0 });
  },

  next() {
    const { step } = get();
    if (step < TOTAL_STEPS - 1) {
      set({ step: step + 1 });
    } else {
      get().end();
    }
  },

  prev() {
    const { step } = get();
    if (step > 0) set({ step: step - 1 });
  },

  end() {
    localStorage.setItem(TOUR_DONE_KEY, '1');
    set({ active: false, step: 0 });
  },
}));
