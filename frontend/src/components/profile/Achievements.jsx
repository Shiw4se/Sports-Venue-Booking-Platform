import React, { useMemo } from 'react';
import styles from './profile.module.css';
import { computeAchievements } from '../../profileStats';

const Achievements = ({ bookings }) => {
    const achievements = useMemo(() => computeAchievements(bookings), [bookings]);
    const unlocked = achievements.filter(a => a.unlocked).length;

    return (
        <section className={styles.card}>
            <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Achievements</h2>
                <span className={styles.muted}>{unlocked} of {achievements.length} unlocked</span>
            </div>
            <ul className={styles.achievements}>
                {achievements.map(a => (
                    <li
                        key={a.id}
                        className={`${styles.achievement} ${a.unlocked ? styles.unlocked : styles.locked}`}
                        title={a.description}
                    >
                        <span className={styles.achievementIcon} aria-hidden="true">{a.icon}</span>
                        <span className={styles.achievementTitle}>{a.title}</span>
                        <span className={styles.achievementDesc}>{a.description}</span>
                        {a.unlocked ? (
                            <span className={styles.achievementDone}>✓ Unlocked</span>
                        ) : (
                            <span className={styles.progress}>
                                <span className={styles.progressTrack}>
                                    <span className={styles.progressFill} style={{ width: `${(a.current / a.target) * 100}%` }} />
                                </span>
                                <span className={styles.progressText}>{a.current}/{a.target}</span>
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
};

export default Achievements;
