import pygame
import platform
import math
import numpy as np
import asyncio

# Initialize Pygame (Pyodide handles this differently, but we mimic setup)
pygame.init()
pygame.mixer.init()

# Screen dimensions
WIDTH, HEIGHT = 1200, 900
screen = pygame.display.set_mode((WIDTH, HEIGHT))

# Colors
BLACK = (0, 0, 0, 180)
WHITE = (245, 245, 245)
TRANSPARENT_WHITE = (245, 245, 245, 128)
RED = (246, 83, 15)
BLUE = (24, 135, 199)
GRAY = (51, 51, 51, 180)
LIGHT_GRAY = (187, 187, 187)
GREEN = (0, 255, 0)
TRANSPARENT_RED = (246, 83, 15, 128)
TRANSPARENT_BLUE = (24, 135, 199, 128)
TRANSPARENT_GRAY = (255, 255, 255, 128)
PROGRESS_START = (0, 255, 255)
PROGRESS_MID = (255, 0, 255)
PROGRESS_END = (255, 255, 0)
PURPLE = (128, 0, 128, 180)
SHADE_WHITE = (255, 255, 255, 26)

# Fonts
large_font = pygame.font.SysFont("gobold,impact,verdana,sans", 36, bold=True)
font = pygame.font.SysFont("gobold,impact,verdana,sans", 28)
small_font = pygame.font.SysFont("gobold,impact,verdana,sans", 14)
tiny_font = pygame.font.SysFont("gobold,impact,verdana,sans", 10)

# Game variables
FPS = 60
ROUND_TIME = 300
timer_seconds = ROUND_TIME
timer_running = False
timer_state = "start"
paused_time = 0
current_round = 1
red_score = 0
blue_score = 0
red_interval_score = 0
blue_interval_score = 0
interval_duration = 10
interval_timer = 0
intervals = []
red_name = ""
blue_name = ""
event_name = ""
red_name_input = ""
blue_name_input = ""
event_name_input = "#EVENT"
red_name_locked = False
blue_name_locked = False
event_name_locked = False
active_input = None
start_time = 0
last_interval_time = 0
round_log = []
cursor_visible = True
cursor_timer = 0
sidebar_open = False
sidebar_x = -400
progress_width = 1100
woodblock_played = False

# UI elements positions
red_name_rect = pygame.Rect(50, 30, 320, 40)
blue_name_rect = pygame.Rect(WIDTH - 370, 30, 320, 40)
event_name_rect = pygame.Rect((370 + 830) // 2 - 160, 30, 320, 40)
score_red_rect = pygame.Rect(50, 100, 170, 45)
score_blue_rect = pygame.Rect(WIDTH - 220, 100, 170, 45)
logo_rect = pygame.Rect(540, 84, 120, 32)
timer_rect = pygame.Rect(WIDTH // 2 - 85, 170, 170, 50)
round_label_rect = pygame.Rect(WIDTH // 2 - 50, 250, 100, 40)
round_up_rect = pygame.Rect(WIDTH // 2 + 90, 250, 40, 40)
round_down_rect = pygame.Rect(WIDTH // 2 - 140, 250, 40, 40)
start_button_rect = pygame.Rect(WIDTH // 2 - 190, 300, 170, 40)
reset_button_rect = pygame.Rect(WIDTH // 2 + 20, 300, 170, 40)
progress_rect = pygame.Rect(50, 350, WIDTH - 100, 10)
graph_rect = pygame.Rect(50, 360, WIDTH - 100, HEIGHT - 450)
sidebar_rect = pygame.Rect(-400, 30, 400, HEIGHT - 80)
arrow_rect = pygame.Rect(0, HEIGHT // 2 - 20, 40, 40)
copy_button_rect = pygame.Rect(110, sidebar_rect.bottom - 50, 180, 40)

def draw_text(text, font, color, surface, x, y, center=False):
    textobj = font.render(text.upper(), True, color)
    textrect = textobj.get_rect()
    if center:
        textrect.center = (x, y)
    else:
        textrect.topleft = (x, y)
    surface.blit(textobj, textrect)

def draw_button(text, rect, color, hover=False, radius=2):
    hover_rect = pygame.Rect(rect.x - 1, rect.y - 1, rect.width + 2, rect.height + 2) if hover else rect
    pygame.draw.rect(screen, LIGHT_GRAY if hover else color, hover_rect, border_radius=radius)
    pygame.draw.rect(screen, LIGHT_GRAY, hover_rect, 1, border_radius=radius)
    draw_text(text, small_font, WHITE, screen, rect.centerx, rect.centery, center=True)

def draw_progress_bar(animation_time):
    pygame.draw.rect(screen, PURPLE, progress_rect, border_radius=2)
    if progress_width > 0:
        gradient_surface = pygame.Surface((progress_rect.width, progress_rect.height), pygame.SRCALPHA)
        for x in range(int(progress_rect.width)):
            t = x / progress_rect.width
            if t < 0.5:
                t1 = t / 0.5
                r = int(PROGRESS_START[0] * (1 - t1) + PROGRESS_MID[0] * t1)
                g = int(PROGRESS_START[1] * (1 - t1) + PROGRESS_MID[1] * t1)
                b = int(PROGRESS_START[2] * (1 - t1) + PROGRESS_MID[2] * t1)
            else:
                t2 = (t - 0.5) / 0.5
                r = int(PROGRESS_MID[0] * (1 - t2) + PROGRESS_END[0] * t2)
                g = int(PROGRESS_MID[1] * (1 - t2) + PROGRESS_MID[1] * t2)
                b = int(PROGRESS_MID[2] * (1 - t2) + PROGRESS_END[2] * t2)
            pygame.draw.line(gradient_surface, (r, g, b), (x, 0), (x, progress_rect.height))
        fill_surface = pygame.Surface((progress_width, progress_rect.height), pygame.SRCALPHA)
        fill_surface.blit(gradient_surface, (0, 0), (0, 0, progress_width, progress_rect.height))
        screen.blit(fill_surface, (progress_rect.x, progress_rect.y))

def draw_graph():
    pygame.draw.rect(screen, GRAY, graph_rect, border_radius=2)
    interval_width = graph_rect.width / (ROUND_TIME / interval_duration)
    max_height = graph_rect.height - 30
    for i, (red, blue) in enumerate(intervals):
        x = graph_rect.left + i * interval_width
        if red > blue:
            color = RED
            height = (red / (red + blue + 1)) * max_height if red + blue > 0 else 0
        elif blue > red:
            color = BLUE
            height = (blue / (red + blue + 1)) * max_height if red + blue > 0 else 0
        else:
            color = TRANSPARENT_GRAY
            height = max_height / 4
        pygame.draw.rect(screen, color, (x, graph_rect.bottom - height, interval_width - 2, height))
    if len(intervals) * interval_duration < ROUND_TIME:
        x = graph_rect.left + len(intervals) * interval_width
        if red_interval_score > blue_interval_score:
            color = TRANSPARENT_RED
            height = (red_interval_score / (red_interval_score + blue_interval_score + 1)) * max_height if red_interval_score + blue_interval_score > 0 else 0
        elif blue_interval_score > red_interval_score:
            color = TRANSPARENT_BLUE
            height = (blue_interval_score / (red_interval_score + blue_interval_score + 1)) * max_height if red_interval_score + blue_interval_score > 0 else 0
        else:
            color = TRANSPARENT_GRAY
            height = max_height / 4
        surface = pygame.Surface((interval_width - 2, height), pygame.SRCALPHA)
        surface.fill(color)
        screen.blit(surface, (x, graph_rect.bottom - height))
    for i in range(ROUND_TIME, -1, -30):
        x = graph_rect.left + (ROUND_TIME - i) * (graph_rect.width / ROUND_TIME)
        pygame.draw.line(screen, LIGHT_GRAY, (x, graph_rect.bottom), (x, graph_rect.bottom - 10))
        if i % 60 == 0:
            draw_text(f"{i // 60}:00", tiny_font, WHITE, screen, x, graph_rect.bottom, center=True)

async def update_loop():
    global timer_seconds, timer_running, timer_state, paused_time, current_round, red_score, blue_score
    global red_interval_score, blue_interval_score, interval_timer, intervals, red_name, blue_name
    global event_name, red_name_input, blue_name_input, event_name_input, red_name_locked
    global blue_name_locked, event_name_locked, active_input, start_time, last_interval_time
    global round_log, cursor_visible, cursor_timer, sidebar_open, sidebar_x, progress_width
    global woodblock_played
    clock = pygame.time.Clock()
    logo_surface = pygame.image.load('https://i.imgur.com/5a2L5z3.png').convert_alpha()
    logo_surface = pygame.transform.scale(logo_surface, (120, 32))

    while True:
        mouse_pos = pygame.mouse.get_pos()
        animation_time = clock.get_rawtime() / 1000.0
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                return
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if red_name_rect.collidepoint(event.pos) and not red_name_locked:
                    active_input = "red"
                elif blue_name_rect.collidepoint(event.pos) and not blue_name_locked:
                    active_input = "blue"
                elif event_name_rect.collidepoint(event.pos) and not event_name_locked:
                    active_input = "event"
                elif round_up_rect.collidepoint(event.pos):
                    current_round = min(5, current_round + 1)
                elif round_down_rect.collidepoint(event.pos):
                    current_round = max(1, current_round - 1)
                elif start_button_rect.collidepoint(event.pos):
                    if timer_state == "start":
                        timer_running = True
                        timer_state = "pause"
                        start_time = pygame.time.get_ticks()
                    elif timer_state == "pause":
                        timer_running = False
                        timer_state = "resume"
                        paused_time += pygame.time.get_ticks() - start_time
                    elif timer_state == "resume":
                        timer_running = True
                        timer_state = "pause"
                        start_time = pygame.time.get_ticks()
                elif reset_button_rect.collidepoint(event.pos):
                    timer_seconds = ROUND_TIME
                    timer_running = False
                    timer_state = "start"
                    paused_time = 0
                    current_round = 1
                    red_score = 0
                    blue_score = 0
                    red_interval_score = 0
                    blue_interval_score = 0
                    interval_timer = 0
                    intervals = []
                    round_log = []
                    red_name = ""
                    blue_name = ""
                    event_name = ""
                    red_name_input = ""
                    blue_name_input = ""
                    event_name_input = "#EVENT"
                    red_name_locked = False
                    blue_name_locked = False
                    event_name_locked = False
                    active_input = None
                    sidebar_open = False
                    sidebar_x = -400
                    progress_width = 1100
                elif arrow_rect.collidepoint(event.pos):
                    sidebar_open = not sidebar_open
                elif copy_button_rect.move(sidebar_x, 0).collidepoint(event.pos) and sidebar_open:
                    pygame.scrap.put(pygame.SCRAP_TEXT, "\n".join(round_log).encode())
            elif event.type == pygame.KEYDOWN and active_input:
                if event.key == pygame.K_RETURN:
                    if active_input == "red" and red_name_input:
                        red_name = red_name_input
                        red_name_locked = True
                    elif active_input == "blue" and blue_name_input:
                        blue_name = blue_name_input
                        blue_name_locked = True
                    elif active_input == "event" and event_name_input:
                        event_name = event_name_input
                        event_name_locked = True
                    active_input = None
                elif event.key == pygame.K_BACKSPACE:
                    if active_input == "red":
                        red_name_input = red_name_input[:-1]
                    elif active_input == "blue":
                        blue_name_input = blue_name_input[:-1]
                    elif active_input == "event":
                        event_name_input = event_name_input[:-1]
                elif event.unicode.isalnum() or event.unicode in " -_":
                    if active_input == "red" and len(red_name_input) < 15:
                        red_name_input += event.unicode
                    elif active_input == "blue" and len(blue_name_input) < 15:
                        blue_name_input += event.unicode
                    elif active_input == "event" and len(event_name_input) < 15:
                        event_name_input += event.unicode

        if timer_running:
            elapsed_time = (pygame.time.get_ticks() - start_time + paused_time) / 1000.0
            timer_seconds = max(0, ROUND_TIME - elapsed_time)
            progress_width = int(1100 * (timer_seconds / ROUND_TIME))
            if timer_seconds <= 0:
                timer_running = False
                timer_state = "start"
                paused_time = 0
                intervals.append((red_interval_score, blue_interval_score))
                round_log.append(f"ROUND {current_round}: {red_name or 'RED CORNER'} {red_interval_score}, {blue_name or 'BLUE CORNER'} {blue_interval_score}")
                if red_interval_score > blue_interval_score:
                    round_log.append(f"{red_name or 'RED CORNER'} WINS 10-9")
                    red_score += 10
                    blue_score += 9
                elif blue_interval_score > red_interval_score:
                    round_log.append(f"{blue_name or 'BLUE CORNER'} WINS 10-9")
                    blue_score += 10
                    red_score += 9
                else:
                    round_log.append("DRAW")
                    red_score += 10
                    blue_score += 10
                red_interval_score = 0
                blue_interval_score = 0
                current_round += 1
                if current_round > 5:
                    current_round = 5
                intervals = []
            interval_timer = elapsed_time % interval_duration
            if interval_timer < (elapsed_time - last_interval_time) and timer_seconds > 0:
                last_interval_time = elapsed_time
                intervals.append((red_interval_score, blue_interval_score))
                red_interval_score = 0
                blue_interval_score = 0
                if not woodblock_played:
                    pygame.mixer.Sound('https://i.imgur.com/5a2L5z3.png').play()  # Placeholder sound URL
                    woodblock_played = True
            else:
                woodblock_played = False

        cursor_timer += 1
        if cursor_timer >= 30:  # Blink every half second at 60 FPS
            cursor_visible = not cursor_visible
            cursor_timer = 0

        sidebar_x = -400 + (400 if sidebar_open else 0)

        screen.fill(BLACK)
        draw_text(event_name or "#EVENT", large_font, WHITE, screen, WIDTH // 2, 10, center=True)
        pygame.draw.rect(screen, GRAY, red_name_rect, border_radius=2)
        pygame.draw.rect(screen, GREEN if red_name_locked else LIGHT_GRAY, red_name_rect, 1, border_radius=2)
        pygame.draw.rect(screen, GRAY, blue_name_rect, border_radius=2)
        pygame.draw.rect(screen, GREEN if blue_name_locked else LIGHT_GRAY, blue_name_rect, 1, border_radius=2)
        pygame.draw.rect(screen, GRAY, event_name_rect, border_radius=2)
        pygame.draw.rect(screen, GREEN if event_name_locked else LIGHT_GRAY, event_name_rect, 1, border_radius=2)
        draw_text(red_name_input if active_input == "red" else red_name or "RED CORNER", font, RED if red_name or active_input == "red" else TRANSPARENT_WHITE, screen, red_name_rect.x + 8, red_name_rect.centery - font.get_height() // 2)
        blue_text = blue_name_input if active_input == "blue" else blue_name or "BLUE CORNER"
        draw_text(blue_text, font, BLUE if blue_name or active_input == "blue" else TRANSPARENT_WHITE, screen, blue_name_rect.right - font.size(blue_text.upper())[0] - 8, blue_name_rect.centery - font.get_height() // 2)
        event_text = event_name_input if active_input == "event" else event_name or "#EVENT"
        draw_text(event_text, font, WHITE if event_name or active_input == "event" else TRANSPARENT_WHITE, screen, event_name_rect.centerx, event_name_rect.centery, center=True)
        if cursor_visible and active_input:
            cursor_x = red_name_rect.x + 8
            cursor_y = red_name_rect.centery - font.get_height() // 2
            if active_input == "red":
                text_width = font.size(red_name_input.upper())[0]
                cursor_x += text_width
            elif active_input == "blue":
                text_width = font.size(blue_name_input.upper())[0]
                cursor_x = blue_name_rect.right - text_width - 8
            elif active_input == "event":
                text_width = font.size(event_name_input.upper())[0]
                cursor_x = event_name_rect.centerx - text_width // 2
                cursor_y = event_name_rect.centery - font.get_height() // 2
            pygame.draw.line(screen, WHITE, (cursor_x, cursor_y), (cursor_x, cursor_y + 28), 2)
        if active_input == "red":
            draw_text("ENTER", small_font, TRANSPARENT_WHITE, screen, red_name_rect.right - 50, red_name_rect.centery - small_font.get_height() // 2, center=True)
        elif active_input == "blue":
            draw_text("ENTER", small_font, TRANSPARENT_WHITE, screen, blue_name_rect.right - 50, blue_name_rect.centery - small_font.get_height() // 2, center=True)
        elif active_input == "event":
            draw_text("ENTER", small_font, TRANSPARENT_WHITE, screen, event_name_rect.right - 50, event_name_rect.centery - small_font.get_height() // 2, center=True)
        screen.blit(logo_surface, logo_rect)
        draw_text(f"{red_score}", large_font, RED, screen, red_name_rect.x, score_red_rect.y + 10)
        draw_text(f"{blue_score}", large_font, BLUE, screen, blue_name_rect.right - large_font.size(str(blue_score))[0], score_red_rect.y + 10)
        pygame.draw.rect(screen, GRAY, timer_rect, border_radius=2)
        pygame.draw.rect(screen, GREEN if timer_running else LIGHT_GRAY, timer_rect, 1, border_radius=2)
        minutes = int(timer_seconds // 60)
        seconds = int(timer_seconds % 60)
        draw_text(f"{minutes}:{seconds:02d}", large_font, WHITE, screen, timer_rect.centerx, timer_rect.centery, center=True)
        draw_text("ROUND", small_font, WHITE, screen, round_label_rect.centerx, round_label_rect.top - 13, center=True)
        pygame.draw.rect(screen, GRAY, round_label_rect, border_radius=2)
        pygame.draw.rect(screen, LIGHT_GRAY, round_label_rect, 1, border_radius=2)
        draw_text(f"{current_round}", font, WHITE, screen, round_label_rect.centerx, round_label_rect.centery, center=True)
        draw_button("−", round_down_rect, GRAY, round_down_rect.collidepoint(mouse_pos), radius=2)
        draw_button("+", round_up_rect, GRAY, round_up_rect.collidepoint(mouse_pos), radius=2)
        draw_button("START" if timer_state == "start" else "PAUSE" if timer_state == "pause" else "RESUME", start_button_rect, GRAY, start_button_rect.collidepoint(mouse_pos))
        draw_button("RESET", reset_button_rect, GRAY, reset_button_rect.collidepoint(mouse_pos))
        draw_progress_bar(animation_time)
        draw_graph()
        pygame.draw.rect(screen, BLACK, (sidebar_x, sidebar_rect.y, sidebar_rect.width, sidebar_rect.height), border_radius=2)
        pygame.draw.rect(screen, LIGHT_GRAY, (sidebar_x, sidebar_rect.y, sidebar_rect.width, sidebar_rect.height), 1, border_radius=2)
        if sidebar_x <= -400:
            shade_surface = pygame.Surface((30, HEIGHT), pygame.SRCALPHA)
            shade_surface.fill(SHADE_WHITE)
            screen.blit(shade_surface, (0, 0))
        arrow_text = ">" if not sidebar_open else "<"
        arrow_color = LIGHT_GRAY if arrow_rect.collidepoint(mouse_pos) else WHITE
        draw_text(arrow_text, font, arrow_color, screen, arrow_rect.centerx, arrow_rect.centery, center=True)
        if sidebar_open:
            y = sidebar_rect.y + 10
            draw_text("SCORECARD", small_font, WHITE, screen, sidebar_x + sidebar_rect.width // 2, y, center=True)
            y += 30
            for log in round_log:
                log_font = tiny_font if small_font.size(log.upper())[0] > 380 else small_font
                draw_text(log, log_font, WHITE, screen, sidebar_x + 10, y)
                y += 20
            y += 30
            red_points = 0
            blue_points = 0
            for log in round_log:
                if f"{red_name or 'RED CORNER'} WINS 10-9" in log:
                    red_points += 10
                    blue_points += 9
                elif f"{red_name or 'RED CORNER'} WINS 10-8" in log:
                    red_points += 10
                    blue_points += 8
                elif f"{blue_name or 'BLUE CORNER'} WINS 10-9" in log:
                    blue_points += 10
                    red_points += 9
                elif f"{blue_name or 'BLUE CORNER'} WINS 10-8" in log:
                    blue_points += 10
                    red_points += 8
                elif "DRAW" in log:
                    red_points += 10
                    blue_points += 10
            decision_text = f"DECISION: {red_name or 'RED CORNER'} {red_points}, {blue_name or 'BLUE CORNER'} {blue_points}"
            decision_font = tiny_font if small_font.size(decision_text.upper())[0] > 380 else small_font
            draw_text(decision_text, decision_font, WHITE, screen, sidebar_x + sidebar_rect.width // 2, y, center=True)
            if current_round == 5 and timer_seconds <= 0:
                y += 30
                if red_points > blue_points:
                    draw_text(f"{red_name or 'RED CORNER'} WINS {red_points}-{blue_points} UNANIMOUS DECISION!", small_font, RED, screen, sidebar_x + 10, y)
                elif blue_points > red_points:
                    draw_text(f"{blue_name or 'BLUE CORNER'} WINS {blue_points}-{red_points} UNANIMOUS DECISION!", small_font, BLUE, screen, sidebar_x + 10, y)
                else:
                    draw_text("FIGHT ENDS IN A DRAW!", small_font, WHITE, screen, sidebar_x + 10, y)
            y = sidebar_rect.bottom - 50
            draw_button("COPY TO CLIPBOARD", copy_button_rect.move(sidebar_x, 0), GRAY, copy_button_rect.move(sidebar_x, 0).collidepoint(mouse_pos))

        await asyncio.sleep(1.0 / FPS)
        pygame.display.flip()

async def main():
    global logo_surface
    logo_surface = pygame.image.load('https://i.imgur.com/5a2L5z3.png').convert_alpha()
    logo_surface = pygame.transform.scale(logo_surface, (120, 32))
    await update_loop()

if platform.system() == "Emscripten":
    asyncio.ensure_future(main())
else:
    asyncio.run(main())
